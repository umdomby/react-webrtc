import React, { useState, useEffect, useRef } from 'react';
import './App.css';

function App() {
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [pc, setPc] = useState(null);
  const [ws, setWs] = useState(null);
  const [status, setStatus] = useState('Disconnected');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [chatMessages, setChatMessages] = useState([]);
  const [iceCandidates, setIceCandidates] = useState([]);
  const [debugLog, setDebugLog] = useState([]);
  const [videoDevices, setVideoDevices] = useState([]);
  const [audioDevices, setAudioDevices] = useState([]);
  const [selectedVideo, setSelectedVideo] = useState('');
  const [selectedAudio, setSelectedAudio] = useState('');
  const [dataChannel, setDataChannel] = useState(null);
  const [isCallStarted, setIsCallStarted] = useState(false);

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const debugConsoleRef = useRef(null);

  // Инициализация устройств
  useEffect(() => {
    const getDevices = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devices.filter(device => device.kind === 'videoinput');
        const audioInputs = devices.filter(device => device.kind === 'audioinput');

        setVideoDevices(videoInputs);
        setAudioDevices(audioInputs);

        if (videoInputs.length > 0) setSelectedVideo(videoInputs[0].deviceId);
        if (audioInputs.length > 0) setSelectedAudio(audioInputs[0].deviceId);

        addToDebugLog('Devices enumerated');
      } catch (err) {
        addToDebugLog(`Error enumerating devices: ${err.message}`);
        setError(`Device error: ${err.message}`);
      }
    };

    getDevices();
  }, []);

  // Подключение к WebSocket серверу с переподключением
  useEffect(() => {
    let websocket;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 5;
    const reconnectDelay = 3000;

    const connectWebSocket = () => {
      websocket = new WebSocket('ws://localhost:8080/ws');

      websocket.onopen = () => {
        addToDebugLog('WebSocket connected');
        setStatus('Connected (waiting for call)');
        setWs(websocket);
        reconnectAttempts = 0;
      };

      websocket.onclose = (event) => {
        if (event.code !== 1000 && reconnectAttempts < maxReconnectAttempts) {
          addToDebugLog(`WebSocket disconnected, attempting to reconnect (${reconnectAttempts + 1}/${maxReconnectAttempts})`);
          setStatus(`Disconnected, reconnecting... (${reconnectAttempts + 1}/${maxReconnectAttempts})`);
          setTimeout(connectWebSocket, reconnectDelay);
          reconnectAttempts++;
        } else {
          addToDebugLog('WebSocket disconnected permanently');
          setStatus('Disconnected');
          setError('WebSocket connection closed');
        }
      };

      websocket.onerror = (err) => {
        addToDebugLog(`WebSocket error: ${err.message || 'Unknown error'}`);
        setError(`WebSocket error: ${err.message || 'Unknown error'}`);
      };

      websocket.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          addToDebugLog(`Received message: ${JSON.stringify(data)}`);

          if (data.type === 'answer') {
            await handleAnswer(data.sdp);
          } else if (data.type === 'ice') {
            await handleRemoteICE(data.candidate);
          }
        } catch (err) {
          addToDebugLog(`Error processing message: ${err.message}`);
          setError(`Message error: ${err.message}`);
        }
      };
    };

    connectWebSocket();

    return () => {
      if (websocket) {
        websocket.close(1000, 'Normal closure');
      }
    };
  }, []);

  // Инициализация локального потока
  useEffect(() => {
    if (selectedVideo || selectedAudio) {
      initLocalStream();
    }
  }, [selectedVideo, selectedAudio]);

  const addToDebugLog = (message) => {
    const timestamp = new Date().toISOString();
    setDebugLog(prev => [...prev, `${timestamp}: ${message}`]);
    if (debugConsoleRef.current) {
      debugConsoleRef.current.scrollTop = debugConsoleRef.current.scrollHeight;
    }
  };

  const initLocalStream = async () => {
    try {
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }

      const constraints = {
        video: selectedVideo ? { deviceId: { exact: selectedVideo } } : true,
        audio: selectedAudio ? { deviceId: { exact: selectedAudio } } : true
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      setLocalStream(stream);

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      addToDebugLog('Local stream initialized');
    } catch (err) {
      addToDebugLog(`Error getting user media: ${err.message}`);
      setError(`Media error: ${err.message}`);
    }
  };

  const createPeerConnection = () => {
    try {
      const config = {
        iceServers: [
          {
            urls: [
              'turn:213.184.249.66:3478?transport=udp',
              'turn:213.184.249.66:3478?transport=tcp',
              'turns:213.184.249.66:5349'
            ],
            username: 'user1',
            credential: 'pass1'
          },
          { urls: 'stun:stun.l.google.com:19302' }
        ],
        iceTransportPolicy: 'all',
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require',
        iceCandidatePoolSize: 0
      };

      const peerConnection = new RTCPeerConnection(config);
      setPc(peerConnection);
      addToDebugLog('PeerConnection created with TURN servers');

      // Обработчики событий PeerConnection
      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          addToDebugLog(`New ICE candidate: ${JSON.stringify(event.candidate)}`);
          setIceCandidates(prev => [...prev, event.candidate]);
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'ice',
              candidate: event.candidate
            }));
          } else {
            addToDebugLog('Cannot send ICE candidate - WebSocket not ready');
          }
        } else {
          addToDebugLog('ICE gathering complete');
        }
      };

      peerConnection.oniceconnectionstatechange = () => {
        const state = peerConnection.iceConnectionState;
        addToDebugLog(`ICE connection state: ${state}`);
        setStatus(`ICE state: ${state}`);

        if (state === 'failed') {
          addToDebugLog('ICE connection failed, restarting ICE...');
          peerConnection.restartIce();
        }
      };

      peerConnection.onconnectionstatechange = () => {
        addToDebugLog(`Connection state: ${peerConnection.connectionState}`);
        setStatus(`Connection state: ${peerConnection.connectionState}`);
      };

      peerConnection.onsignalingstatechange = () => {
        addToDebugLog(`Signaling state: ${peerConnection.signalingState}`);
      };

      peerConnection.ontrack = (event) => {
        addToDebugLog('Received remote track');
        if (remoteVideoRef.current && !remoteVideoRef.current.srcObject) {
          const stream = new MediaStream();
          stream.addTrack(event.track);
          remoteVideoRef.current.srcObject = stream;
          setRemoteStream(stream);
        }
      };

      // Добавляем локальный поток
      if (localStream) {
        localStream.getTracks().forEach(track => {
          peerConnection.addTrack(track, localStream);
        });
        addToDebugLog('Added local tracks to PeerConnection');
      }

      // Создаем DataChannel для чата
      const dc = peerConnection.createDataChannel('chat', {
        ordered: true,
        maxPacketLifeTime: 3000
      });
      setDataChannel(dc);

      dc.onopen = () => {
        addToDebugLog('Data channel opened');
        setStatus('Data channel ready');
      };

      dc.onmessage = (event) => {
        addToDebugLog(`Received message: ${event.data}`);
        setChatMessages(prev => [...prev, `Remote: ${event.data}`]);
      };

      dc.onclose = () => {
        addToDebugLog('Data channel closed');
      };

      dc.onerror = (error) => {
        addToDebugLog(`Data channel error: ${error}`);
      };

      return peerConnection;
    } catch (err) {
      addToDebugLog(`Error creating PeerConnection: ${err.message}`);
      setError(`PeerConnection error: ${err.message}`);
      return null;
    }
  };

  const startCall = async () => {
    if (isCallStarted) return;

    try {
      setIsCallStarted(true);
      setStatus('Starting call...');
      addToDebugLog('Starting call');

      const peerConnection = createPeerConnection();
      if (!peerConnection) return;

      const offerOptions = {
        offerToReceiveAudio: 1,
        offerToReceiveVideo: 1
      };

      const offer = await peerConnection.createOffer(offerOptions);
      addToDebugLog(`Created offer: ${offer.sdp}`);

      // Устанавливаем локальное описание перед отправкой offer
      await peerConnection.setLocalDescription(offer);
      addToDebugLog('Set local description');

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'offer',
          sdp: offer.sdp
        }));
        setStatus('Call started - waiting for answer');
      } else {
        addToDebugLog('Cannot send offer - WebSocket not ready');
        setError('WebSocket connection not ready');
      }
    } catch (err) {
      setIsCallStarted(false);
      addToDebugLog(`Error starting call: ${err.message}`);
      setError(`Call error: ${err.message}`);
    }
  };

  const handleAnswer = async (sdp) => {
    try {
      if (!pc) {
        addToDebugLog('No PeerConnection to handle answer');
        return;
      }

      addToDebugLog(`Received answer: ${sdp}`);
      await pc.setRemoteDescription(new RTCSessionDescription({
        type: 'answer',
        sdp: sdp
      }));
      addToDebugLog('Set remote description');
      setStatus('Call connected');
    } catch (err) {
      addToDebugLog(`Error handling answer: ${err.message}`);
      setError(`Answer error: ${err.message}`);
    }
  };

  const handleRemoteICE = async (candidate) => {
    try {
      if (!pc) {
        addToDebugLog('No PeerConnection to handle ICE candidate');
        return;
      }

      addToDebugLog(`Adding remote ICE candidate: ${JSON.stringify(candidate)}`);
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      addToDebugLog(`Error adding ICE candidate: ${err.message}`);
      setError(`ICE error: ${err.message}`);
    }
  };

  const sendMessage = () => {
    if (!dataChannel || dataChannel.readyState !== 'open' || !message.trim()) return;

    try {
      dataChannel.send(message);
      setChatMessages(prev => [...prev, `You: ${message}`]);
      setMessage('');
      addToDebugLog(`Sent message: ${message}`);
    } catch (err) {
      addToDebugLog(`Error sending message: ${err.message}`);
      setError(`Message send error: ${err.message}`);
    }
  };

  const endCall = () => {
    setIsCallStarted(false);

    if (pc) {
      pc.close();
      setPc(null);
      addToDebugLog('Call ended');
    }

    if (remoteVideoRef.current && remoteVideoRef.current.srcObject) {
      remoteVideoRef.current.srcObject.getTracks().forEach(track => track.stop());
      remoteVideoRef.current.srcObject = null;
      setRemoteStream(null);
    }

    if (dataChannel) {
      setDataChannel(null);
    }

    setStatus('Disconnected');
    setIceCandidates([]);
  };

  return (
      <div className="App">
        <header className="App-header">
          <h1>WebRTC Video Chat with TURN</h1>

          <div className="media-container">
            <div className="video-container">
              <video
                  ref={localVideoRef}
                  className="local-video"
                  autoPlay
                  playsInline
                  muted
              />
              <video
                  ref={remoteVideoRef}
                  className="remote-video"
                  autoPlay
                  playsInline
              />
            </div>
          </div>

          <div className="controls">
            <div className="device-controls">
              <div className="device-selector">
                <label>Video Input:</label>
                <select
                    value={selectedVideo}
                    onChange={(e) => setSelectedVideo(e.target.value)}
                >
                  {videoDevices.map(device => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.label || `Camera ${videoDevices.indexOf(device) + 1}`}
                      </option>
                  ))}
                </select>
              </div>

              <div className="device-selector">
                <label>Audio Input:</label>
                <select
                    value={selectedAudio}
                    onChange={(e) => setSelectedAudio(e.target.value)}
                >
                  {audioDevices.map(device => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.label || `Microphone ${audioDevices.indexOf(device) + 1}`}
                      </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="button-group">
              <button
                  onClick={startCall}
                  disabled={!localStream || !ws || isCallStarted}
              >
                Start Call
              </button>
              <button
                  onClick={endCall}
                  disabled={!pc}
              >
                End Call
              </button>
            </div>

            <div className="chat">
              <input
                  type="text"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Type a message"
                  onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                  disabled={!dataChannel || dataChannel.readyState !== 'open'}
              />
              <button
                  onClick={sendMessage}
                  disabled={!dataChannel || dataChannel.readyState !== 'open' || !message.trim()}
              >
                Send
              </button>
            </div>

            <div className="status">
              <p>Status: {status}</p>
              {error && <p className="error">{error}</p>}
              <div className="chat-messages">
                {chatMessages.map((msg, index) => (
                    <p key={index}>{msg}</p>
                ))}
              </div>
            </div>
          </div>

          <div className="debug-panel">
            <h3>Debug Information</h3>
            <div className="ice-candidates">
              <h4>ICE Candidates:</h4>
              {iceCandidates.map((candidate, index) => (
                  <div key={index} className="candidate">
                    {candidate.candidate}
                  </div>
              ))}
            </div>

            <div className="debug-console" ref={debugConsoleRef}>
              <h4>Debug Console:</h4>
              {debugLog.map((log, index) => (
                  <div key={index}>{log}</div>
              ))}
            </div>
          </div>
        </header>
      </div>
  );
}

export default App;
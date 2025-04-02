import React, { useState, useEffect, useRef } from 'react';
import './App.css';

function App() {
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream] = useState(new MediaStream());
  const [pc, setPc] = useState(null);
  const [status, setStatus] = useState('Disconnected');
  const [isCallStarted, setIsCallStarted] = useState(false);
  const [messages, setMessages] = useState([]);

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const wsRef = useRef(null);
  const reconnectAttempts = useRef(0);

  // Инициализация медиа
  useEffect(() => {
    const initMedia = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true
        });
        setLocalStream(stream);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.error("Media error:", err);
        setStatus(`Media Error: ${err.message}`);
      }
    };

    initMedia();

    return () => {
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // Подключение WebSocket
  useEffect(() => {
    const connect = () => {
      //const wsUrl = process.env.REACT_APP_WS_URL || 'ws://localhost:8080/ws';
      const wsUrl = 'ws://localhost:8080/ws';
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus('Connected');
        reconnectAttempts.current = 0;
        console.log('WebSocket connected');
      };

      ws.onclose = (e) => {
        setStatus(`Disconnected (${e.code})`);
        if (reconnectAttempts.current < 5) {
          const delay = Math.min(3000, 1000 * (reconnectAttempts.current + 1));
          console.log(`Reconnecting in ${delay}ms...`);
          setTimeout(connect, delay);
          reconnectAttempts.current += 1;
        }
      };

      ws.onerror = (err) => {
        console.error('WebSocket error:', err);
        setStatus('Connection error');
      };

      ws.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('Received:', data);

          if (!pc) return;

          if (data.type === 'answer') {
            await pc.setRemoteDescription(new RTCSessionDescription({
              type: 'answer',
              sdp: data.sdp
            }));
            setStatus('Call connected');
          } else if (data.type === 'ice') {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
            } catch (e) {
              console.error('ICE candidate error:', e);
            }
          }
        } catch (err) {
          console.error('Message handling error:', err);
        }
      };
    };

    connect();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [pc]);

  const createPeerConnection = () => {
    const config = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
      ]
    };

    const peerConnection = new RTCPeerConnection(config);

    // Локальные треки
    if (localStream) {
      localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
      });
    }

    // Удаленные треки
    peerConnection.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    peerConnection.onicecandidate = (event) => {
      if (event.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'ice',
          candidate: event.candidate
        }));
      }
    };

    peerConnection.oniceconnectionstatechange = () => {
      setStatus(`ICE: ${peerConnection.iceConnectionState}`);
    };

    peerConnection.onconnectionstatechange = () => {
      console.log('Connection state:', peerConnection.connectionState);
    };

    return peerConnection;
  };

  const startCall = async () => {
    if (isCallStarted || !wsRef.current) return;

    try {
      const peerConnection = createPeerConnection();
      setPc(peerConnection);
      setIsCallStarted(true);
      setStatus('Starting call...');

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      wsRef.current.send(JSON.stringify({
        type: 'offer',
        sdp: offer.sdp
      }));
    } catch (err) {
      console.error('Call error:', err);
      setIsCallStarted(false);
      setStatus(`Error: ${err.message}`);
    }
  };

  const endCall = () => {
    if (pc) {
      pc.close();
      setPc(null);
    }
    setIsCallStarted(false);
    setStatus('Disconnected');
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
  };

  return (
      <div className="app">
        <h1>WebRTC Video Call</h1>

        <div className="video-container">
          <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="local-video"
          />
          <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="remote-video"
          />
        </div>

        <div className="controls">
          <button
              onClick={startCall}
              disabled={isCallStarted || status !== 'Connected'}
          >
            Start Call
          </button>
          <button
              onClick={endCall}
              disabled={!isCallStarted}
          >
            End Call
          </button>
          <p className="status">Status: {status}</p>
        </div>

        <div className="logs">
          <h3>Connection Log</h3>
          {messages.map((msg, i) => (
              <p key={i}>{msg}</p>
          ))}
        </div>
      </div>
  );
}

export default App;
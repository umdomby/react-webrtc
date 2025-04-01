import React, { useState, useEffect, useRef } from 'react';
import SimplePeer from 'simple-peer';
import './App.css';

function App() {
  const [message, setMessage] = useState('');
  const [received, setReceived] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  const [iceState, setIceState] = useState('');
  const [signalingState, setSignalingState] = useState('');
  const [iceCandidates, setIceCandidates] = useState([]);
  const [devices, setDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState('');

  const peerRef = useRef(null);
  const wsRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const localStreamRef = useRef(null);

  // Получаем список медиаустройств
  useEffect(() => {
    const getDevices = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(device => device.kind === 'videoinput');
        setDevices(videoDevices);
        if (videoDevices.length > 0) {
          setSelectedDevice(videoDevices[0].deviceId);
        }
      } catch (err) {
        console.error('Error enumerating devices:', err);
      }
    };

    getDevices();
  }, []);

  // Инициализация WebSocket
  useEffect(() => {
    const ws = new WebSocket('ws://localhost:8080/ws');

    ws.onopen = () => {
      console.log('WebSocket connected');
      setConnectionError('');
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
      cleanupConnection();
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      setConnectionError('WebSocket connection failed');
    };

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        console.log('Received WebSocket message:', data);

        if (!peerRef.current) {
          console.warn('Peer is not initialized');
          return;
        }

        if (data.type === 'answer') {
          console.log('Received answer SDP');
          peerRef.current.signal(data);
        } else if (data.type === 'ice') {
          console.log('Received ICE candidate:', data.candidate);
          peerRef.current.signal(data.candidate);
        }
      } catch (err) {
        console.error('Error processing WebSocket message:', err);
      }
    };

    wsRef.current = ws;

    return () => {
      cleanupConnection();
      ws.close();
    };
  }, []);

  const cleanupConnection = () => {
    if (peerRef.current) {
      peerRef.current.destroy();
      peerRef.current = null;
    }
    setIsConnected(false);
    setIceState('');
    setSignalingState('');
    setIceCandidates([]);

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
  };

  const startConnection = async () => {
    try {
      cleanupConnection();

      // Получаем медиапоток с выбранного устройства
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: selectedDevice ? { exact: selectedDevice } : undefined },
        audio: true
      });

      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      console.log('Creating new peer connection');
      const peer = new SimplePeer({
        initiator: true,
        trickle: true,
        stream: stream,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' }
          ]
        }
      });

      peer.on('error', (err) => {
        console.error('P2P error:', err);
        setConnectionError(`Connection error: ${err.message}`);
        cleanupConnection();
      });

      peer.on('signal', (data) => {
        console.log('Peer signal:', data);
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify(data));
        }
      });

      peer.on('connect', () => {
        console.log('P2P connected!');
        setIsConnected(true);
        setConnectionError('');
      });

      peer.on('data', (data) => {
        console.log('Received data:', data.toString());
        setReceived(data.toString());
      });

      peer.on('stream', (stream) => {
        console.log('Received remote stream');
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = stream;
        }
      });

      peer.on('iceConnectionStateChange', () => {
        console.log('ICE state:', peer.iceConnectionState);
        setIceState(peer.iceConnectionState);
      });

      peer.on('signalingStateChange', () => {
        console.log('Signaling state:', peer.signalingState);
        setSignalingState(peer.signalingState);
      });

      peer.on('iceCandidate', (candidate) => {
        console.log('ICE candidate:', candidate);
        setIceCandidates(prev => [...prev, candidate]);
      });

      peer.on('close', () => {
        console.log('P2P connection closed');
        cleanupConnection();
      });

      peerRef.current = peer;
    } catch (err) {
      console.error('Connection error:', err);
      setConnectionError(`Failed to start connection: ${err.message}`);
      cleanupConnection();
    }
  };

  const sendMessage = () => {
    if (peerRef.current && isConnected) {
      console.log('Sending message:', message);
      peerRef.current.send(message);
      setMessage('');
    }
  };

  const handleDeviceChange = (e) => {
    setSelectedDevice(e.target.value);
  };

  return (
      <div className="App">
        <header className="App-header">
          <h1>WebRTC Video Chat</h1>

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

          <div className="device-selector">
            <label htmlFor="video-device">Camera:</label>
            <select
                id="video-device"
                value={selectedDevice}
                onChange={handleDeviceChange}
                disabled={isConnected}
            >
              {devices.map(device => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Camera ${device.deviceId.slice(0, 5)}`}
                  </option>
              ))}
            </select>
          </div>

          <div className="controls">
            <button
                onClick={startConnection}
                disabled={isConnected || devices.length === 0}
            >
              {isConnected ? 'Connected' : 'Start Connection'}
            </button>

            <div className="chat">
              <input
                  type="text"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  disabled={!isConnected}
                  placeholder="Type your message"
              />
              <button
                  onClick={sendMessage}
                  disabled={!isConnected}
              >
                Send
              </button>
            </div>
          </div>

          <div className="status">
            <h3>Connection Status</h3>
            <p>WebSocket: {wsRef.current?.readyState === WebSocket.OPEN ? 'Connected' : 'Disconnected'}</p>
            <p>WebRTC: {isConnected ? 'Connected' : 'Disconnected'}</p>
            <p>ICE State: {iceState || 'N/A'}</p>
            <p>Signaling State: {signalingState || 'N/A'}</p>
            <p>Received: {received || 'No messages yet'}</p>
            {connectionError && <p className="error">{connectionError}</p>}
          </div>

          <div className="ice-candidates">
            <h3>ICE Candidates ({iceCandidates.length})</h3>
            <div className="candidates-list">
              {iceCandidates.map((candidate, i) => (
                  <div key={i} className="candidate">
                    {candidate.candidate}
                  </div>
              ))}
            </div>
          </div>
        </header>
      </div>
  );
}

export default App;
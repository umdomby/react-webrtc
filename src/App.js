// App.js
import React, { useState, useEffect, useRef } from 'react';
import SimplePeer from 'simple-peer';
import './App.css';

const DEBUG = true;

function App() {
  const [message, setMessage] = useState('');
  const [received, setReceived] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  const [iceConnectionState, setIceConnectionState] = useState('');
  const [signalingState, setSignalingState] = useState('');
  const [iceCandidates, setIceCandidates] = useState([]);

  const peerRef = useRef(null);
  const wsRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);

  const log = (...args) => {
    if (DEBUG) console.log(...args);
  };

  useEffect(() => {
    const initWebSocket = () => {
      wsRef.current = new WebSocket('ws://localhost:8080/ws');

      wsRef.current.onopen = () => {
        log('WebSocket connected');
        setConnectionError('');
      };

      wsRef.current.onclose = () => {
        log('WebSocket disconnected');
        cleanupConnection();
      };

      wsRef.current.onerror = (error) => {
        log('WebSocket error:', error);
        setConnectionError('WebSocket connection failed');
      };

      wsRef.current.onmessage = handleWebSocketMessage;
    };

    initWebSocket();

    return () => {
      cleanupConnection();
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  const handleWebSocketMessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      log('Received WebSocket message:', data);

      if (!peerRef.current) {
        log('Peer is not initialized, ignoring message');
        return;
      }

      if (data.type === 'answer') {
        log('Received answer SDP');
        peerRef.current.signal(data);
      } else if (data.type === 'ice' && data.candidate) {
        log('Received ICE candidate:', data.candidate);
        peerRef.current.signal({
          candidate: data.candidate.candidate,
          sdpMLineIndex: data.candidate.sdpMLineIndex,
          sdpMid: data.candidate.sdpMid
        });
      }
    } catch (err) {
      log('Error processing WebSocket message:', err);
    }
  };

  const cleanupConnection = () => {
    if (peerRef.current) {
      log('Destroying peer connection');
      peerRef.current.destroy();
      peerRef.current = null;
    }
    setIsConnected(false);
    setIceConnectionState('');
    setSignalingState('');
    setIceCandidates([]);
  };

  const startConnection = async () => {
    try {
      cleanupConnection();

      log('Creating new peer connection');
      const peer = new SimplePeer({
        initiator: true,
        trickle: true,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' }
          ],
          iceTransportPolicy: 'all'
        }
      });

      peer.on('error', (err) => {
        log('P2P error:', err);
        setConnectionError(`Connection error: ${err.message}`);
        cleanupConnection();
      });

      peer.on('signal', (data) => {
        log('Peer signal:', data);
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify(data));
        }
      });

      peer.on('connect', () => {
        log('P2P connected!');
        setIsConnected(true);
        setConnectionError('');
      });

      peer.on('data', (data) => {
        log('Received data:', data.toString());
        setReceived(data.toString());
      });

      peer.on('iceConnectionStateChange', () => {
        const state = peer.iceConnectionState;
        log('ICE connection state changed:', state);
        setIceConnectionState(state);
      });

      peer.on('signalingStateChange', () => {
        const state = peer.signalingState;
        log('Signaling state changed:', state);
        setSignalingState(state);
      });

      peer.on('iceCandidate', (candidate) => {
        log('New ICE candidate:', candidate);
        setIceCandidates(prev => [...prev, candidate]);
      });

      peer.on('close', () => {
        log('P2P connection closed');
        cleanupConnection();
      });

      peerRef.current = peer;
    } catch (err) {
      log('Connection error:', err);
      setConnectionError(`Failed to start connection: ${err.message}`);
      cleanupConnection();
    }
  };

  const sendMessage = () => {
    if (peerRef.current && isConnected) {
      log('Sending message:', message);
      peerRef.current.send(message);
      setMessage('');
    }
  };

  return (
      <div className="App">
        <header className="App-header">
          <h1>WebRTC Debug Console</h1>

          <div className="video-container">
            <video ref={localVideoRef} autoPlay playsInline muted className="local-video" />
            <video ref={remoteVideoRef} autoPlay playsInline className="remote-video" />
          </div>

          <div className="controls">
            <button onClick={startConnection} disabled={isConnected}>
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
              <button onClick={sendMessage} disabled={!isConnected}>
                Send
              </button>
            </div>
          </div>

          <div className="status">
            <h3>Connection Status</h3>
            <p>WebSocket: {wsRef.current?.readyState === WebSocket.OPEN ? 'Connected' : 'Disconnected'}</p>
            <p>WebRTC: {isConnected ? 'Connected' : 'Disconnected'}</p>
            <p>ICE State: {iceConnectionState || 'N/A'}</p>
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
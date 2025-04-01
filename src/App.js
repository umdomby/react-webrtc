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

  const peerRef = useRef(null);
  const wsRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const localStreamRef = useRef(null);

  useEffect(() => {
    return () => {
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = null;
      }
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = null;
      }
    };
  }, []);

  useEffect(() => {
    const ws = new WebSocket('ws://localhost:8080/ws');

    ws.onopen = () => {
      console.log('[WebSocket] Connected');
      setConnectionError('');
    };

    ws.onclose = () => {
      console.log('[WebSocket] Disconnected');
      cleanupConnection();
    };

    ws.onerror = (error) => {
      console.error('[WebSocket] Error:', error);
      setConnectionError('WebSocket connection failed');
    };

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        console.log('[WebSocket] Received message:', data);

        if (!peerRef.current) {
          console.warn('Peer is not initialized');
          return;
        }

        if (data.type === 'ice') {
          const candidate = new RTCIceCandidate({
            candidate: data.candidate.candidate,
            sdpMid: data.candidate.sdpMid || null,
            sdpMLineIndex: data.candidate.sdpMLineIndex || null
          });
          peerRef.current.addIceCandidate(candidate).catch(console.error);
        }

        if (data.type === 'answer') {
          console.log('[WebRTC] Received answer SDP');
          peerRef.current.signal({
            type: 'answer',
            sdp: data.sdp
          });
        } else if (data.type === 'ice' && data.candidate) {
          console.log('[WebRTC] Received ICE candidate:', data.candidate);
          peerRef.current.signal({
            candidate: data.candidate.candidate,
            sdpMLineIndex: data.candidate.sdpMLineIndex,
            sdpMid: data.candidate.sdpMid
          });
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
      console.log('[WebRTC] Destroying peer connection');
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

      console.log('[WebRTC] Getting user media');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });

      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      console.log('[WebRTC] Creating new peer connection');
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
        console.error('[WebRTC] Error:', err);
        setConnectionError(`WebRTC error: ${err.message}`);
        cleanupConnection();
      });

      peer.on('signal', (data) => {
        console.log('[WebRTC] Signaling data:', data);
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify(data));
        }
      });

      peer.on('connect', () => {
        console.log('[WebRTC] Peer connection established');
        setIsConnected(true);
        setConnectionError('');
      });

      peer.on('data', (data) => {
        console.log('[WebRTC] Received data:', data.toString());
        setReceived(data.toString());
      });

      peer.on('stream', (stream) => {
        console.log('[WebRTC] Received remote stream');
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = stream;
        }
      });

      peer.on('iceConnectionStateChange', () => {
        console.log('[WebRTC] ICE state:', peer.iceConnectionState);
        setIceState(peer.iceConnectionState);
      });

      peer.on('signalingStateChange', () => {
        console.log('[WebRTC] Signaling state:', peer.signalingState);
        setSignalingState(peer.signalingState);
      });

      peer.on('iceCandidate', (candidate) => {
        console.log('[WebRTC] New ICE candidate:', candidate);
        setIceCandidates(prev => [...prev, candidate]);
      });

      peer.on('close', () => {
        console.log('[WebRTC] Connection closed');
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
      console.log('[WebRTC] Sending message:', message);
      peerRef.current.send(message);
      setMessage('');
    }
  };

  return (
      <div className="App">
        <header className="App-header">
          <h1>WebRTC Video Chat</h1>

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
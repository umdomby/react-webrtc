import React, { useState, useEffect, useRef } from 'react';
import SimplePeer from 'simple-peer';
import MediaDevices from './MediaDevices';
import './App.css';

function App() {
  const [message, setMessage] = useState('');
  const [received, setReceived] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  const peerRef = useRef(null);
  const wsRef = useRef(null);
  const [mediaStream, setMediaStream] = useState(null);

  useEffect(() => {
    const initWebSocket = () => {
      wsRef.current = new WebSocket('ws://192.168.0.151:8080/ws');

      wsRef.current.onopen = () => {
        console.log('WebSocket connected');
        setConnectionError('');
      };

      wsRef.current.onclose = () => {
        console.log('WebSocket disconnected');
        cleanupConnection();
      };

      wsRef.current.onerror = (error) => {
        console.error('WebSocket error:', error);
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
      console.log('Received WebSocket message:', data);

      if (!peerRef.current) {
        console.warn('Peer is not initialized');
        return;
      }

      if (data.type === 'answer') {
        peerRef.current.signal(data.sdp);
      } else if (data.type === 'ice' && data.candidate) {
        peerRef.current.signal(data.candidate);
      }
    } catch (err) {
      console.error('Error processing WebSocket message:', err);
    }
  };

  const cleanupConnection = () => {
    if (peerRef.current) {
      peerRef.current.destroy();
      peerRef.current = null;
    }
    setIsConnected(false);

    if (mediaStream) {
      mediaStream.getTracks().forEach(track => track.stop());
      setMediaStream(null);
    }
  };

  const startConnection = async () => {
    try {
      cleanupConnection();

      // Получаем медиапоток (если нужно)
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });
      setMediaStream(stream);

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

      peer.on('signal', (data) => {
        console.log('Peer signal:', data);
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify(data));
        }
      });

      peer.on('connect', () => {
        setIsConnected(true);
        setConnectionError('');
        console.log('P2P connected!');
      });

      peer.on('data', (data) => {
        setReceived(data.toString());
      });

      peer.on('stream', (stream) => {
        console.log('Received remote stream');
        // Здесь можно обработать удаленный поток
      });

      peer.on('error', (err) => {
        console.error('P2P error:', err);
        setConnectionError(`Connection error: ${err.message}`);
        cleanupConnection();
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
      peerRef.current.send(message);
      setMessage('');
    }
  };

  return (
      <div className="App">
        <header className="App-header">
          <h1>WebRTC Video Chat</h1>

          <div className="media-container">
            <MediaDevices
                mediaStream={mediaStream}
                isConnected={isConnected}
            />
          </div>

          <div className="controls">
            <button
                onClick={startConnection}
                disabled={isConnected}
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
            <p>Status: {isConnected ? 'Connected' : 'Disconnected'}</p>
            <p>Received: {received || 'No messages yet'}</p>
            {connectionError && <p className="error">{connectionError}</p>}
          </div>
        </header>
      </div>
  );
}

export default App;
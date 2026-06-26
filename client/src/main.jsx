import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, info: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error('REACT CRASH:', error, errorInfo);
    this.setState({ info: errorInfo });
    setTimeout(() => {
      document.getElementById('root').innerHTML = 
        '<div style="background:#111;color:#f44;padding:20px;font-family:monospace">' +
        '<h2>Crash: ' + error.message + '</h2>' +
        '<pre style="white-space:pre-wrap;word-break:break-all">' + error.stack + '</pre>' +
        '<pre>' + (errorInfo?.componentStack || '') + '</pre>' +
        '</div>';
    }, 100);
  }
  render() {
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
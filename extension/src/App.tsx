import { useEffect, useState } from 'react'
import './App.css'

function App() {
  const [isConnected, setIsConnected] = useState<boolean | null>(null)

  useEffect(() => {
    // Poll the python bridge health endpoint
    const checkHealth = async () => {
      try {
        const res = await fetch('http://localhost:37421/health')
        if (res.ok) {
          setIsConnected(true)
        } else {
          setIsConnected(false)
        }
      } catch (err) {
        setIsConnected(false)
      }
    }

    checkHealth()
    const interval = setInterval(checkHealth, 3000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif', textAlign: 'center' }}>
      <h2>Vinted HQ</h2>
      <p style={{ fontSize: '18px', fontWeight: 'bold' }}>
        Connection: {isConnected === null ? '⏳' : isConnected ? '🟢 Connected' : '🔴 Disconnected'}
      </p>
    </div>
  )
}

export default App

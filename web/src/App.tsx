import { useState } from 'react'
import LeftPanel from './components/LeftPanel'
import RightPanel from './components/RightPanel'
import './App.css'
import './components/styles.css'

function App() {
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)

  return (
    <div className="app-container">
      <LeftPanel sessionId={selectedSessionId} />
      <RightPanel 
        selectedSessionId={selectedSessionId}
        onSessionSelect={setSelectedSessionId}
      />
    </div>
  )
}

export default App


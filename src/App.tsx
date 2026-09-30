import { useEffect } from 'react'
import { FilePicker } from './components/FilePicker'
import { Icon } from './components/Icon'
import { Player } from './components/Player'
import { PwaControls } from './components/PwaControls'
import { LyricsPanel } from './components/LyricsPanel'
import { SavedProjects } from './components/SavedProjects'
import { StemMixer } from './components/StemMixer'
import { removeLegacyChordCache } from './analysis/analysisCache'
import './App.css'

function App() {
  // The session belongs to explicit user actions, not this view's lifetime.
  // StrictMode effect replay / Fast Refresh must not dispose a selected file.
  useEffect(() => { removeLegacyChordCache() }, [])

  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="brand" href="./" aria-label="Music Dissector 홈">
          <span className="brand-mark"><Icon name="wave" /></span>
          <span className="brand-copy">
            <span className="brand-title">Music Dissector</span>
            <span className="brand-subtitle">음악해체분석기</span>
          </span>
        </a>
        <div className="header-actions">
          <PwaControls />
        </div>
      </header>

      <main>
        <div className="page-heading">
          <div>
            <p className="eyebrow">YOUR MUSIC. YOUR SPACE.</p>
            <h1>음악의 온전한 해체를 위해, Music Dissector<span>.</span></h1>
            <p className="page-description">내 기기의 음악을 열고, 원하는 세션만을 추출해 보세요.</p>
          </div>
          <span className="workspace-label"><Icon name="headphones" /> PERSONAL SPACE</span>
        </div>

        <div className="workspace">
          <section className="library-panel" aria-labelledby="library-title">
            <div className="section-heading">
              <h2 id="library-title"><span>01</span> 내 음악</h2>
              <Icon name="folder" />
            </div>
            <FilePicker />
            <div className="privacy-note">
              <span className="note-icon"><Icon name="shield" /></span>
              <div><h3>음악은 내 기기에 그대로</h3><p>선택한 파일은 서버에 업로드되지 않습니다.<br />이 브라우저에서만 재생됩니다.</p></div>
            </div>
          </section>
          <Player />
          <LyricsPanel />
          <StemMixer />
          <SavedProjects />
        </div>

        <div className="workspace-footer">
          <span>Made By KTM - MuDissector</span>
        </div>
      </main>
      <footer className="app-footer"><span>음악과 나 사이, 필요한 것만.</span><span>Contact: mindalpang27@naver.com</span></footer>
    </div>
  )
}

export default App

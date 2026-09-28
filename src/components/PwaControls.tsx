import { useRef } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { useInstall } from '../hooks/useInstall'
import { Icon } from './Icon'

export function PwaControls() {
  const { installed, install } = useInstall()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  async function onInstall() {
    if (!await install()) dialogRef.current?.showModal()
  }

  return (
    <>
      {installed ? <span className="installed-label"><Icon name="check" /> 설치됨</span> : <button className="install-button" onClick={() => void onInstall()}><Icon name="download" /><span>앱 설치</span></button>}
      <dialog ref={dialogRef} className="install-dialog" aria-labelledby="install-title">
        <div className="dialog-heading"><span className="brand-mark"><Icon name="wave" /></span><button className="icon-button" aria-label="설치 안내 닫기" onClick={() => dialogRef.current?.close()}><Icon name="close" /></button></div>
        <h2 id="install-title">StemLab을 홈 화면에</h2>
        <p>Galaxy의 Chrome에서 이 사이트를 열고, 브라우저 메뉴 <strong>⋮ → 홈 화면에 추가 → 설치</strong>를 선택해 주세요. 브라우저에 따라 메뉴 이름이 다를 수 있어요.</p>
        <p>설치 메뉴가 보이지 않으면 HTTPS 주소인지 확인하고, 페이지를 한 번 새로고침해 주세요. 이미 설치했다면 홈 화면에서 StemLab을 열 수 있어요.</p>
        <div className="dialog-note"><Icon name="shield" /><span>한 번 접속한 뒤에는 인터넷 없이도 앱을 열고 기기의 음악을 선택할 수 있어요.</span></div>
        <button className="primary-button" onClick={() => dialogRef.current?.close()}>확인</button>
      </dialog>
      {(offlineReady || needRefresh) && (
        <div className="pwa-notice" role="status">
          <Icon name={needRefresh ? 'download' : 'check'} />
          <span>{needRefresh ? '새 버전이 준비됐어요. 새로고침하면 재생 중인 음악이 닫혀요.' : '오프라인 사용 준비 완료. 인터넷 없이도 음악을 열 수 있어요.'}</span>
          {needRefresh && <button className="notice-action" onClick={() => void updateServiceWorker(true)}>새로고침</button>}
          <button className="icon-button" aria-label="알림 닫기" onClick={() => { setOfflineReady(false); setNeedRefresh(false) }}><Icon name="close" /></button>
        </div>
      )}
    </>
  )
}

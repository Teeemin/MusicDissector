import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { projectStore } from '../projects/projectStore'
import { projectStorageSupported } from '../projects/ProjectRepository'
import type { ProjectEntry } from '../projects/projectTypes'
import { useMixer } from '../mixer/useMixer'
import { usePlayback } from '../stores/playbackStore'
import { formatFileSize } from '../utils/format'
import './SavedProjects.css'

const storageSize = (bytes: number) => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GiB` : formatFileSize(bytes)

export function ProjectSaveControls() {
  const state = useSyncExternalStore(projectStore.subscribe, projectStore.getSnapshot)
  const { separationStatus, trackId } = useMixer()
  const { track, isReady } = usePlayback()
  const currentId = projectStore.currentId()
  const supported = projectStorageSupported()
  const ready = isReady && separationStatus === 'ready' && trackId === track?.id
  return <div className="project-save" aria-label="분리 결과 저장">
    <p>{currentId ? '저장된 프로젝트입니다. 믹서 변경은 현재 설정 저장을 눌러야 반영됩니다.' : '분리 결과는 현재 세션에서만 유지됩니다.'}</p>
    <div className="project-actions">
      {currentId ? <button type="button" disabled={!!state.busy || !ready} onClick={() => void projectStore.updateMixer()}>현재 설정 저장</button>
        : <button type="button" disabled={!supported || !ready || !!state.busy} onClick={() => void projectStore.save()}>분리 결과 저장</button>}
      {(state.busy === 'save' || state.busy === 'load') && <button type="button" onClick={projectStore.cancel}>프로젝트 작업 취소</button>}
    </div>
    <small>원본·6개 stem·곡 정보·믹서 설정을 이 브라우저에 저장합니다. 파일 다운로드와는 별개입니다.</small>
    {!supported && <p role="status">이 브라우저에서는 프로젝트 저장을 지원하지 않습니다. 현재 세션의 재생은 계속 사용할 수 있어요.</p>}
    {state.progress && <div className="project-progress" role="status"><span className="analysis-spinner" aria-hidden="true" />{state.progress.label} · {state.progress.completed} / {state.progress.total}</div>}
    {state.message && <p role="status">{state.message}</p>}
    {state.error && <p className="project-error" role="alert">{state.error}</p>}
    {state.persistent !== null && <small>{state.persistent ? '브라우저가 영구 저장소 사용을 허용했습니다.' : '영구 저장소가 허용되지 않아 브라우저가 공간 부족 시 저장 결과를 정리할 수 있습니다.'} 사이트 데이터를 직접 삭제하면 저장 결과도 삭제됩니다.</small>}
  </div>
}

export function SavedProjects() {
  const state = useSyncExternalStore(projectStore.subscribe, projectStore.getSnapshot)
  const [removing, setRemoving] = useState<ProjectEntry | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { projectStore.initialize() }, [])
  useEffect(() => { if (removing) dialog.current?.showModal(); else dialog.current?.close() }, [removing])
  return <section className="saved-projects" aria-labelledby="projects-title">
    <div className="section-heading"><h2 id="projects-title"><span>05</span> 저장된 분리 결과</h2><button type="button" disabled={!!state.busy || !projectStorageSupported()} onClick={() => void projectStore.refresh()}>목록 새로고침</button></div>
    <p className="project-storage" role="status">저장 공간 · {state.usage === null ? '사용량을 확인할 수 없습니다.' : `${storageSize(state.usage)} 사용 중${state.quota ? ` / ${storageSize(state.quota)}` : ''}`}<small>모델과 앱을 포함한 이 브라우저의 사이트 저장공간입니다.</small></p>
    {state.entries.length === 0 && <p className="project-empty">저장된 분리 결과가 없습니다. 분리 후 저장 버튼을 눌러 보관하세요.</p>}
    <ul className="project-list">{state.entries.map(entry => <li key={entry.id}>
      <article aria-label={entry.title}>
        <div className="project-info"><h3>{entry.title}</h3>{entry.artist && <p>{entry.artist}</p>}<small>{entry.savedAt ? new Date(entry.savedAt).toLocaleString('ko-KR') : '저장 미완료'} · {entry.bytes ? storageSize(entry.bytes) : '용량 확인 필요'}</small>{entry.issue && <p className="project-error">{entry.issue}</p>}</div>
        <div className="project-actions"><button type="button" disabled={!!state.busy || !!entry.issue} onClick={() => void projectStore.load(entry.id)}>불러오기</button><button type="button" disabled={!!state.busy} onClick={() => setRemoving(entry)}>삭제</button></div>
      </article>
    </li>)}</ul>
    <dialog ref={dialog} className="install-dialog project-dialog" aria-labelledby="project-delete-title" onCancel={() => setRemoving(null)}>
      <h2 id="project-delete-title">이 분리 결과를 삭제할까요?</h2><p>{removing?.title}<br />저장된 원본과 stem을 삭제합니다. 이 프로젝트를 사용 중이라면 재생도 종료됩니다. AI 모델은 유지됩니다.</p>
      <div className="project-actions"><button type="button" onClick={() => setRemoving(null)}>취소</button><button type="button" onClick={() => { if (removing) void projectStore.remove(removing.id); setRemoving(null) }}>삭제 확인</button></div>
    </dialog>
  </section>
}

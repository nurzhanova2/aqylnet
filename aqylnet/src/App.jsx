import { useState, useEffect, useRef } from 'react';
import styles from './App.module.css';
import TopBar from './components/TopBar/TopBar';
import Sidebar from './components/Sidebar/Sidebar';
import PersonaDrawer from './components/PersonaDrawer/PersonaDrawer';
import DiscussionPage from './pages/DiscussionPage/DiscussionPage';
import SetupPage from './pages/SetupPage/SetupPage';
import LibraryPage from './pages/LibraryPage/LibraryPage';
import AnalyticsPage from './pages/AnalyticsPage/AnalyticsPage';
import ProjectsPage from './pages/ProjectsPage/ProjectsPage';
import { fetchPersonas, fetchProject, fetchProjects, updateProject, runIteration, addPersonaToProject, updateModeratorMessage } from './api';

function loadPersonas(setPersonas) {
  fetchPersonas().then(setPersonas).catch(console.error);
}

const ITER_MAX = 5;
const LAST_PROJECT_ID_KEY = 'aqylnet:lastProjectId';

function loadLastProjectId() {
  const saved = Number(localStorage.getItem(LAST_PROJECT_ID_KEY));
  return saved > 0 ? saved : null;
}

export default function App() {
  const [screen, setScreen]           = useState('discussion');
  const [playing, setPlaying]         = useState(false);
  const [iterCur, setIterCur]         = useState(0);
  const [iterMax, setIterMax]         = useState(ITER_MAX);
  const [moderator, setModerator]     = useState(true);
  const [selectedIdx, setSelectedIdx] = useState(null);
  const [drawerOpen, setDrawerOpen]   = useState(false);
  const [personas, setPersonas]           = useState([]);
  // Persisted so that reloading the page (or the "Диалог"/"Отчёт" reload
  // check in the verification script) keeps showing the same project's
  // discussion/report instead of silently resetting to the demo project —
  // there is no URL routing in this app, so without this a hard reload had
  // no way to know which project was open.
  const [currentProjectId, setCurrentProjectId] = useState(loadLastProjectId);
  const [project, setProject]                   = useState(null);
  const [iterationKey, setIterationKey]         = useState(0); // bumped after each LLM run or persona-composition change, to trigger DiscussionPage refetch
  const [addingPersonaId, setAddingPersonaId]   = useState(null);
  const [addPersonaError, setAddPersonaError]   = useState(null);
  const [isGenerating, setIsGenerating]         = useState(false); // run-iteration request in flight
  const [isRevealing, setIsRevealing]           = useState(false); // DiscussionPage is still playing back this round's responses
  const [generationError, setGenerationError]   = useState(null);
  const [pendingModeratorDraft, setPendingModeratorDraft] = useState(null);
  const [isFullscreen, setIsFullscreen]         = useState(false);
  const appRef = useRef(null);

  useEffect(() => { loadPersonas(setPersonas); }, []);

  useEffect(() => {
    let cancelled = false;

    function applyProject(p) {
      if (cancelled) return;
      setProject(p);
      setIterCur(p.currentIteration);
      setIterMax(p.iterations);
      setModerator(p.moderator);
      setGenerationError(null);
    }

    async function reconcileProject() {
      if (!currentProjectId) {
        try {
          const available = await fetchProjects();
          if (cancelled) return;
          if (available.length > 0) setCurrentProjectId(available[0].id);
          else setScreen('projects');
        } catch (error) {
          if (!cancelled) setGenerationError(error.message);
        }
        return;
      }

      try {
        applyProject(await fetchProject(currentProjectId));
      } catch (error) {
        if (cancelled) return;
        console.error('Failed to load active project:', error);
        if (error.status !== 404) {
          setGenerationError(error.message);
          return;
        }

        try {
          const available = await fetchProjects();
          if (cancelled) return;
          const stillListed = available.some((item) => item.id === currentProjectId);
          if (stillListed) {
            setGenerationError('Проект временно недоступен на одном из серверов. Повторите открытие.');
            setScreen('projects');
            return;
          }
          const fallback = available[0] ?? null;
          setProject(null);
          if (fallback) setCurrentProjectId(fallback.id);
          else {
            localStorage.removeItem(LAST_PROJECT_ID_KEY);
            setCurrentProjectId(null);
            setScreen('projects');
          }
        } catch (listError) {
          if (!cancelled) setGenerationError(listError.message);
        }
      }
    }

    void reconcileProject();
    return () => { cancelled = true; };
  }, [currentProjectId]);

  useEffect(() => {
    function onFsChange() { setIsFullscreen(Boolean(document.fullscreenElement)); }
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  useEffect(() => {
    if (currentProjectId) localStorage.setItem(LAST_PROJECT_ID_KEY, String(currentProjectId));
    setPendingModeratorDraft(null);
  }, [currentProjectId]);

  const simulationCompleted = project?.status === 'completed' || iterCur >= iterMax;
  const displayIterCur = simulationCompleted ? iterMax : iterCur;
  const iterPct = `${iterMax > 0 ? Math.round((displayIterCur / iterMax) * 100) : 0}%`;

  // Single shared entry point for starting the next discussion round — used
  // by both TopBar's "Продолжить" button and DiscussionPage's own launch
  // button (previously DiscussionPage's button called onGoSetup instead of
  // actually running anything, so it looked broken; TopBar's was the only
  // one that worked). isGenerating covers the network call, isRevealing
  // covers DiscussionPage's sequential message playback afterward — the
  // button must stay disabled for both, or a second click mid-playback would
  // fire a concurrent run-iteration call.
  const runDisabled = isGenerating || isRevealing || simulationCompleted;

  async function handleRunIteration() {
    if (runDisabled || !currentProjectId) return;
    localStorage.setItem(LAST_PROJECT_ID_KEY, String(currentProjectId));
    setIsGenerating(true);
    setPlaying(true);
    setGenerationError(null);
    try {
      if (pendingModeratorDraft?.dirty && pendingModeratorDraft.id) {
        const text = pendingModeratorDraft.text.trim();
        if (!text) throw new Error('\u0412\u043e\u043f\u0440\u043e\u0441 \u043c\u043e\u0434\u0435\u0440\u0430\u0442\u043e\u0440\u0430 \u043d\u0435 \u043c\u043e\u0436\u0435\u0442 \u0431\u044b\u0442\u044c \u043f\u0443\u0441\u0442\u044b\u043c.');
        await updateModeratorMessage(currentProjectId, pendingModeratorDraft.id, text);
        setPendingModeratorDraft((current) => current ? { ...current, text, dirty: false } : current);
      }
      const result = await runIteration(currentProjectId);
      // currentIteration is the persisted, backend-confirmed count of
      // completed iterations — never bumped optimistically before this.
      setIterCur(result.currentIteration);
      setProject((current) => current
        ? { ...current, currentIteration: result.currentIteration, status: result.status }
        : current);
      setIterationKey((k) => k + 1);

      // The last iteration changes more than the counter: the backend also
      // transitions the project to completed. Re-read the persisted project
      // immediately so every screen observes the authoritative completed
      // state without a hard reload.
      if (result.status === 'completed') {
        try {
          const completedProject = await fetchProject(currentProjectId);
          setProject(completedProject);
          setIterCur(completedProject.currentIteration);
          setIterMax(completedProject.iterations);
          setModerator(completedProject.moderator);
        } catch (refreshError) {
          console.error('Iteration completed, but project refresh failed:', refreshError);
        }
      }
    } catch (e) {
      // Surface BUG-8-sanitized backend messages (e.g. the BUG-4 "already
      // running" 409) instead of only logging them — a failed request must
      // not silently look identical to nothing having happened.
      setGenerationError(e.message || 'Не удалось запустить итерацию.');
    } finally {
      setIsGenerating(false);
      setPlaying(false);
    }
  }

  // Toggles the moderator setting for the currently active project (BUG-7:
  // this previously only flipped local state via setModerator(!moderator),
  // never calling PATCH /projects/:id, so the change was lost on reload).
  // Mirrors handleSetIter's optimistic-update pattern.
  async function handleToggleModerator() {
    const next = !moderator;
    setModerator(next);
    if (!currentProjectId) return;
    try {
      const updated = await updateProject(currentProjectId, { moderator: next });
      setModerator(updated.moderator);
    } catch (e) {
      console.error('Failed to update moderator:', e);
    }
  }

  function handleToggleFullscreen() {
    if (!document.fullscreenElement) {
      appRef.current?.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  }

  function handleSelectPersona(idx) {
    setSelectedIdx(idx);
    setDrawerOpen(true);
  }

  function handleNavigate(s) {
    setScreen(s);
    setDrawerOpen(false);
  }

  function handleSelectProject(id) {
    setCurrentProjectId(id);
    handleNavigate('discussion');
  }

  // Adds a persona to whichever project is currently active. Library personas
  // aren't tied to a project until explicitly added — if no project is active
  // yet, there's nothing to add to, so send the user to create one instead.
  async function handleAddPersonaToProject(personaId) {
    if (!currentProjectId) {
      handleNavigate('setup');
      return;
    }
    setAddingPersonaId(personaId);
    setAddPersonaError(null);
    try {
      await addPersonaToProject(currentProjectId, personaId);
      setIterationKey((k) => k + 1);
      handleNavigate('discussion');
    } catch (e) {
      setAddPersonaError(e.message);
    } finally {
      setAddingPersonaId(null);
    }
  }

  return (
    <div className={styles.app} ref={appRef}>
      <TopBar
        screen={screen}
        onNavigate={handleNavigate}
        title={project?.title || '\u0411\u0435\u0437 \u043d\u0430\u0437\u0432\u0430\u043d\u0438\u044f'}
        model={project?.llmModel || '\u2014'}
        iterCur={displayIterCur}
        iterMax={iterMax}
        playing={playing}
        isGenerating={isGenerating}
        isRevealing={isRevealing}
        isCompleted={simulationCompleted}
        onRunIteration={handleRunIteration}
        playDisabled={runDisabled}
        onFinish={() => handleNavigate('analytics')}
        isFullscreen={isFullscreen}
        onToggleFullscreen={handleToggleFullscreen}
      />

      <div className={styles.body}>
        <Sidebar screen={screen} onNavigate={handleNavigate} />

        {screen === 'discussion' && (
          <DiscussionPage
            personas={personas}
            projectId={currentProjectId}
            iterationKey={iterationKey}
            iterCur={displayIterCur}
            iterMax={iterMax}
            iterPct={iterPct}
            moderator={moderator}
            selectedIdx={selectedIdx}
            onSelectPersona={handleSelectPersona}
            onGoLibrary={() => handleNavigate('library')}
            onGoAnalytics={() => handleNavigate('analytics')}
            onToggleMod={handleToggleModerator}
            onRunIteration={handleRunIteration}
            runDisabled={runDisabled}
            isGenerating={isGenerating}
            isRevealing={isRevealing}
            onRevealingChange={setIsRevealing}
            generationError={generationError}
            onPersonaRemoved={() => setIterationKey((key) => key + 1)}
            onModeratorDraftChange={setPendingModeratorDraft}
          />
        )}

        {screen === 'projects' && (
          <ProjectsPage
            currentProjectId={currentProjectId}
            onSelectProject={handleSelectProject}
            onGoSetup={() => handleNavigate('setup')}
          />
        )}

        {screen === 'setup' && (
          <SetupPage
            personas={personas}
            iterMax={iterMax}
            onGoLibrary={() => handleNavigate('library')}
            onProjectCreated={(id) => setCurrentProjectId(id)}
            onGoDiscussion={() => handleNavigate('discussion')}
          />
        )}

        {screen === 'library' && (
          <LibraryPage
            personas={personas}
            onSelectPersona={handleSelectPersona}
            onGoSetup={() => handleNavigate('setup')}
            onPersonaCreated={() => loadPersonas(setPersonas)}
            hasActiveProject={Boolean(currentProjectId)}
            addingPersonaId={addingPersonaId}
            addPersonaError={addPersonaError}
            onAddToProject={handleAddPersonaToProject}
          />
        )}

        {screen === 'analytics' && (
          <AnalyticsPage
            projectId={currentProjectId}
            projectStatus={project?.status}
            onGoDiscussion={() => handleNavigate('discussion')}
          />
        )}
      </div>

      {drawerOpen && selectedIdx !== null && personas[selectedIdx] && (
        <PersonaDrawer
          persona={personas[selectedIdx]}
          onClose={() => setDrawerOpen(false)}
        />
      )}
    </div>
  );
}

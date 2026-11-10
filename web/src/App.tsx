import React, { useEffect, useState } from 'react';
import { useRoute, navigate } from './lib/router';
import { useApp, useAsync } from './lib/store';
import { api } from './lib/api';
import { Layout } from './components/Layout';
import { ErrorState, Skeleton, Toasts } from './components/ui';
import type { Project } from './lib/types';

import { ProjectsPage } from './pages/Projects';
import { OverviewPage } from './pages/Overview';
import { ScriptPage } from './pages/Script';
import { EngineeringPage } from './pages/Engineering';
import { SkillsPage } from './pages/Skills';
import { StoryboardPage } from './pages/Storyboard';
import { TimelinePage } from './pages/Timeline';
import { VoicesPage } from './pages/Voices';
import { CharactersPage } from './pages/Characters';
import { CharactersLibraryPage } from './pages/CharactersLibrary';
import { TasksPage } from './pages/Tasks';
import { AgentPage } from './pages/Agent';
import { StylesPage } from './pages/Styles';
import { ComicPage } from './pages/Comic';
import { QaPage } from './pages/Qa';
import { ExportPage } from './pages/Export';
import { ModelsPage } from './pages/Models';
import { NodesPage } from './pages/Nodes';
import { TemplatesPage } from './pages/Templates';
import { SettingsPage } from './pages/Settings';

function ProjectShell({ projectId, active }: { projectId: number; active: string }): React.ReactElement {
  const { data, loading, error, reload } = useAsync<Project>(() => api.getProject(projectId), [projectId]);
  const [project, setProject] = useState<Project | null>(null);
  useEffect(() => { if (data) setProject(data); }, [data]);

  const onPrivacyChange = async (v: boolean) => {
    if (!project) return;
    try {
      const updated = await api.patchProject(project.id, { privacy_mode: v });
      setProject(updated);
    } catch {
      /* toast handled by page-level actions */
    }
  };

  const page = (() => {
    switch (active) {
      case 'script': return <ScriptPage projectId={projectId} />;
      case 'storyboard': return <StoryboardPage projectId={projectId} />;
      case 'timeline': return <TimelinePage projectId={projectId} />;
      case 'engineering': return <EngineeringPage projectId={projectId} />;
      case 'skills': return <SkillsPage projectId={projectId} />;
      case 'voices': return <VoicesPage projectId={projectId} />;
      case 'characters': return <CharactersPage projectId={projectId} />;
      case 'tasks': return <TasksPage projectId={projectId} />;
      case 'agent': return <AgentPage projectId={projectId} />;
      case 'styles': return <StylesPage projectId={projectId} project={project} />;
      case 'comic': return <ComicPage projectId={projectId} />;
      case 'qa': return <QaPage projectId={projectId} />;
      case 'export': return <ExportPage projectId={projectId} />;
      default: return <OverviewPage projectId={projectId} project={project} onProjectChange={setProject} />;
    }
  })();

  return (
    <Layout project={project} active={active} onPrivacyChange={onPrivacyChange}>
      {loading && !project ? <div className="panel"><Skeleton rows={4} height={64} /></div> : null}
      {error && !project ? <div className="panel"><ErrorState message={error} onRetry={reload} /></div> : null}
      {project ? page : null}
    </Layout>
  );
}

export function App(): React.ReactElement {
  const route = useRoute();
  const { ready, metaError } = useApp();

  useEffect(() => {
    if (route.path === '/') navigate('/projects', true);
  }, [route.path]);

  if (!ready) {
    return (
      <div style={{ padding: 40 }}>
        <div className="panel"><Skeleton rows={6} height={56} /></div>
      </div>
    );
  }
  if (metaError) {
    return (
      <div style={{ padding: 40 }}>
        <div className="panel"><ErrorState message={'无法连接中台：' + metaError} onRetry={() => location.reload()} /></div>
        <Toasts />
      </div>
    );
  }

  const [first, second, third] = route.segments;

  if (first === 'project' && second) {
    const projectId = Number(second);
    const active = third ?? 'overview';
    return (
      <>
        <ProjectShell projectId={projectId} active={active} />
        <Toasts />
      </>
    );
  }

  if (first === 'characters') { return (<><Layout project={null} active={'/characters'}><CharactersLibraryPage /></Layout><Toasts /></>); }

  const globalPages: Record<string, React.ReactElement> = {
    projects: <ProjectsPage />,
    models: <ModelsPage />,
    nodes: <NodesPage />,
    templates: <TemplatesPage />,
    settings: <SettingsPage />
  };

  const key = first ?? 'projects';
  return (
    <>
      <Layout project={null} active={'/' + key}>
        {globalPages[key] ?? <ProjectsPage />}
      </Layout>
      <Toasts />
    </>
  );
}

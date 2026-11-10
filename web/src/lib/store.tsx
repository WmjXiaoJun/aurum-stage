import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { hub, type HubEvent } from './ws';
import type { Meta } from './types';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'success' | 'error';
}

interface AppState {
  meta: Meta | null;
  metaError: string | null;
  ready: boolean;
  toasts: Toast[];
  notify: (text: string, kind?: Toast['kind']) => void;
  dismiss: (id: number) => void;
  subscribe: (handler: (event: HubEvent) => void) => () => void;
  wsOpen: boolean;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [wsOpen, setWsOpen] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    let alive = true;
    api.meta()
      .then((m) => { if (alive) { setMeta(m); setReady(true); } })
      .catch((err) => { if (alive) { setMetaError(String(err?.message ?? err)); setReady(true); } });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    hub.connect(null);
    const off = hub.onOpen((open) => setWsOpen(open));
    return () => { off(); };
  }, []);

  const notify = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = ++seq.current;
    setToasts((prev) => [...prev.slice(-3), { id, text, kind }]);
    window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), kind === 'error' ? 7000 : 4200);
  }, []);

  const dismiss = useCallback((id: number) => setToasts((prev) => prev.filter((t) => t.id !== id)), []);
  const subscribe = useCallback((handler: (event: HubEvent) => void) => hub.on(handler), []);

  const value = useMemo<AppState>(() => ({ meta, metaError, ready, toasts, notify, dismiss, subscribe, wsOpen }), [meta, metaError, ready, toasts, notify, dismiss, subscribe, wsOpen]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp 必须在 AppProvider 内使用');
  return ctx;
}

export function useMeta(): Meta | null {
  return useApp().meta;
}

/** 订阅某项目的事件（自动带上 project 过滤） */
export function useEvents(projectId: number | null, handler: (event: HubEvent) => void): void {
  const { subscribe } = useApp();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (projectId) hub.connect(projectId);
    const off = subscribe((event) => {
      if (projectId == null || event.project_id == null || event.project_id === projectId) ref.current(event);
    });
    return () => off();
  }, [projectId, subscribe]);
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | null; loading: boolean; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fn()
      .then((res) => { if (alive) { setData(res); setLoading(false); } })
      .catch((err) => { if (alive) { setError(String(err?.message ?? err)); setLoading(false); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);
  return { data, loading, error, reload: () => setNonce((n) => n + 1) };
}

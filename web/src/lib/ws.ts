/** WebSocket 事件总线：自动重连，按 project 订阅 */
export interface HubEvent {
  type: string;
  project_id: number | null;
  ts: number;
  payload: Record<string, unknown>;
}

type Handler = (event: HubEvent) => void;

class Hub {
  private socket: WebSocket | null = null;
  private handlers = new Set<Handler>();
  private projectId: number | null = null;
  private retry = 0;
  private timer: number | null = null;
  private openHandlers = new Set<(open: boolean) => void>();

  connect(projectId: number | null): void {
    this.projectId = projectId;
    if (this.socket && this.socket.readyState <= 1) {
      if (this.socket.readyState === 1) this.subscribe();
      return;
    }
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = proto + '//' + location.host + '/api/v1/ws';
    try {
      this.socket = new WebSocket(url);
    } catch {
      return;
    }
    this.socket.onopen = () => {
      this.retry = 0;
      this.subscribe();
      this.openHandlers.forEach((h) => h(true));
    };
    this.socket.onmessage = (ev) => {
      try {
        const data = JSON.parse(String(ev.data)) as HubEvent;
        this.handlers.forEach((h) => h(data));
      } catch {
        /* 忽略非 JSON */
      }
    };
    this.socket.onclose = () => {
      this.openHandlers.forEach((h) => h(false));
      this.socket = null;
      const delay = Math.min(8000, 400 * Math.pow(2, this.retry++));
      if (this.timer) window.clearTimeout(this.timer);
      this.timer = window.setTimeout(() => this.connect(this.projectId), delay);
    };
    this.socket.onerror = () => {
      try { this.socket?.close(); } catch { /* ignore */ }
    };
  }

  private subscribe(): void {
    if (!this.socket || this.socket.readyState !== 1) return;
    this.socket.send(JSON.stringify({ type: 'subscribe', project_id: this.projectId }));
  }

  on(handler: Handler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  onOpen(handler: (open: boolean) => void): () => void {
    this.openHandlers.add(handler);
    return () => this.openHandlers.delete(handler);
  }
}

export const hub = new Hub();

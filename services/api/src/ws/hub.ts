/** WebSocket 事件中心（9.3）：task.progress / task.preview / task.success / task.failed / node.offline / compose.progress */
export interface SocketLike {
  send(data: string): void;
  on(event: string, listener: (...args: never[]) => void): void;
}

interface Client {
  socket: SocketLike;
  project_id: number | null;
}

const clients = new Set<Client>();

export function registerClient(socket: SocketLike): void {
  const client: Client = { socket, project_id: null };
  clients.add(client);
  socket.on('message', (raw: Buffer | string) => {
    try {
      const msg = JSON.parse(String(raw));
      if (msg && msg.type === 'subscribe') client.project_id = msg.project_id == null ? null : Number(msg.project_id);
      socket.send(JSON.stringify({ type: 'hello', payload: { ok: true, ts: Date.now() } }));
    } catch {
      /* 忽略非法消息 */
    }
  });
  socket.on('close', () => clients.delete(client));
  socket.send(JSON.stringify({ type: 'hello', payload: { ok: true, ts: Date.now() } }));
}

export interface HubEvent {
  type: string;
  project_id?: number | null;
  payload: Record<string, unknown>;
}

export function emit(event: HubEvent): void {
  const data = JSON.stringify({ type: event.type, project_id: event.project_id ?? null, ts: Date.now(), payload: event.payload });
  for (const client of clients) {
    if (client.project_id != null && event.project_id != null && client.project_id !== event.project_id) continue;
    try {
      client.socket.send(data);
    } catch {
      clients.delete(client);
    }
  }
}

export function clientCount(): number {
  return clients.size;
}

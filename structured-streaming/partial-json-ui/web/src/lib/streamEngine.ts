import { JSONParser } from '@streamparser/json';

export interface ParserEvent {
  seq: number;
  /** Path of the value, e.g. `$.skills[2]` or `$.location.city`. */
  path: string;
  value: unknown;
  /** true while the value is still streaming (partial preview). */
  partial: boolean;
}

export type Snapshot = Record<string, unknown>;

export interface EngineCallbacks {
  onEvent?: (event: ParserEvent) => void;
  onSnapshot?: (snapshot: Snapshot | null) => void;
  onError?: (error: Error) => void;
  onEnd?: (snapshot: Snapshot | null) => void;
}

export interface Engine {
  write(chunk: string): void;
  end(): void;
}

export function pathToString(path: (string | number)[]): string {
  return '$' + path.map((p) => (typeof p === 'number' ? `[${p}]` : `.${String(p)}`)).join('');
}

function frameKey(frame: unknown): string | number | undefined {
  if (frame !== null && typeof frame === 'object' && 'key' in frame) {
    return (frame as { key: string | number }).key;
  }
  return frame as string | number;
}

function setAtPath(node: unknown, path: (string | number)[], value: unknown): unknown {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  const current = (node ?? (typeof head === 'number' ? [] : {})) as Record<
    string | number,
    unknown
  >;
  const copy: Record<string | number, unknown> = Array.isArray(current)
    ? ([...(current as unknown[])] as unknown as Record<number, unknown>)
    : { ...current };
  copy[head] = setAtPath(current[head], rest, value);
  return copy;
}

/**
 * Event-driven partial JSON parsing on top of @streamparser/json.
 * Emits a live snapshot + per-value events (path + partial previews), so a UI
 * can render fields as they arrive — before the JSON is complete.
 *
 * The published 0.0.26 API passes one object argument
 * ({ value, key, parent, stack, partial }); we normalize defensively so the
 * engine also survives the older positional callback shape.
 */
export function createEngine(cbs: EngineCallbacks = {}): Engine {
  const options = { emitPartialValues: true, emitPartialTokens: true };
  const parser = new JSONParser(
    options as ConstructorParameters<typeof JSONParser>[0],
  );

  let snapshot: Snapshot | null = null;
  let seq = 0;
  let ended = false;

  const untyped = parser as unknown as {
    onValue: (...args: unknown[]) => void;
    onError: (err: Error) => void;
    isEnded: boolean;
  };

  untyped.onValue = function onValueHandler(...args: unknown[]) {
    let value: unknown;
    let key: string | number | undefined;
    let stack: unknown[] = [];
    let partial = false;

    if (
      args.length >= 1 &&
      args[0] !== null &&
      typeof args[0] === 'object' &&
      'value' in (args[0] as object)
    ) {
      const a = args[0] as {
        value: unknown;
        key?: string | number;
        stack?: unknown[];
        partial?: boolean;
      };
      value = a.value;
      key = a.key;
      stack = a.stack ?? [];
      partial = Boolean(a.partial);
    } else {
      const positional = args as [unknown, string | number | undefined, unknown, unknown[]];
      value = positional[0];
      key = positional[1];
      stack = positional[3] ?? [];
    }

    const path = stack
      .map(frameKey)
      .filter((k): k is string | number => k !== undefined);
    if (key !== undefined) path.push(key);

    snapshot = setAtPath(snapshot, path, value) as Snapshot;
    cbs.onEvent?.({ seq: seq++, path: pathToString(path), value, partial });
    cbs.onSnapshot?.(snapshot);
  };

  untyped.onError = (err: Error) => cbs.onError?.(err);

  return {
    write(chunk: string) {
      try {
        parser.write(chunk);
      } catch (err) {
        cbs.onError?.(err as Error);
      }
    },
    end() {
      if (ended) return;
      ended = true;
      try {
        if (!untyped.isEnded) parser.end();
      } catch (err) {
        cbs.onError?.(err as Error);
      }
      cbs.onEnd?.(snapshot);
    },
  };
}

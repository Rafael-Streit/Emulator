import { Injectable } from '@angular/core';

export type ConsoleSystem = 'gb' | 'gba' | 'nds' | '3ds';

export interface ArcadeGame {
  id: string;
  name: string;
  fileName?: string;
  coverData?: string;
  system: ConsoleSystem;
  rom: Blob;
  size: number;
  checksum: string;
  addedAt: number;
  lastPlayedAt: number;
  playSeconds: number;
}

export interface ArcadeState {
  id: string;
  gameId: string;
  slot: number;
  savedAt: number;
  data: Blob;
  screenshot: string;
}

@Injectable({ providedIn: 'root' })
export class ArcadeStorageService {
  private readonly db: Promise<IDBDatabase> = new Promise((resolve, reject) => {
    const request = indexedDB.open('pocket-arcade', 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('games')) database.createObjectStore('games', { keyPath: 'id' });
      if (!database.objectStoreNames.contains('states')) database.createObjectStore('states', { keyPath: 'id' });
      if (!database.objectStoreNames.contains('settings')) database.createObjectStore('settings', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB konnte nicht geöffnet werden.'));
  });

  async getGames(): Promise<ArcadeGame[]> {
    return this.request<ArcadeGame[]>('games', 'readonly', (store) => store.getAll());
  }

  async getGame(id: string): Promise<ArcadeGame | undefined> {
    return this.request<ArcadeGame | undefined>('games', 'readonly', (store) => store.get(id));
  }

  async saveGame(game: ArcadeGame): Promise<void> {
    await this.request<undefined>('games', 'readwrite', (store) => store.put(game));
  }

  async deleteGame(id: string): Promise<void> {
    await this.request<undefined>('games', 'readwrite', (store) => store.delete(id));
    const states = await this.getStates(id);
    for (const state of states) await this.deleteState(state.id);
  }

  async getStates(gameId: string): Promise<ArcadeState[]> {
    const all = await this.request<ArcadeState[]>('states', 'readonly', (store) => store.getAll());
    return all.filter((state) => state.gameId === gameId).sort((a, b) => b.savedAt - a.savedAt);
  }

  async saveState(state: ArcadeState): Promise<void> {
    await this.request<undefined>('states', 'readwrite', (store) => store.put(state));
  }

  async deleteState(id: string): Promise<void> {
    await this.request<undefined>('states', 'readwrite', (store) => store.delete(id));
  }

  async getSetting<T>(id: string, fallback: T): Promise<T> {
    const row = await this.request<{ id: string; value: T } | undefined>('settings', 'readonly', (store) => store.get(id));
    return row?.value ?? fallback;
  }

  async saveSetting<T>(id: string, value: T): Promise<void> {
    await this.request<undefined>('settings', 'readwrite', (store) => store.put({ id, value }));
  }

  private async request<T>(
    storeName: string,
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest,
  ): Promise<T> {
    const database = await this.db;
    return new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      const request = operation(transaction.objectStore(storeName));
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(request.error ?? new Error('Browser-Speicher ist fehlgeschlagen.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Browser-Speicher wurde abgebrochen.'));
    });
  }
}





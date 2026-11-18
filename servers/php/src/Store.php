<?php

namespace Daryeel;

use PDO;

/** Every record lives in one SQLite table: kind + id + JSON data. */
final class Store
{
    private PDO $db;
    private int $depth = 0;

    public function __construct(string $file)
    {
        if (!is_dir(dirname($file))) {
            mkdir(dirname($file), 0775, true);
        }
        $this->db = new PDO('sqlite:' . $file, null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
        $this->db->exec('PRAGMA busy_timeout = 5000');
        $this->db->exec('PRAGMA journal_mode = WAL');
        $this->db->exec(
            'CREATE TABLE IF NOT EXISTS records (
               kind TEXT NOT NULL, id TEXT NOT NULL, owner TEXT, data TEXT NOT NULL, created_at TEXT NOT NULL,
               PRIMARY KEY (kind, id));
             CREATE INDEX IF NOT EXISTS records_owner ON records (kind, owner);'
        );
    }

    public static function now(): string
    {
        return (new \DateTimeImmutable('now', new \DateTimeZone('UTC')))->format('Y-m-d\TH:i:s.v\Z');
    }

    public function get(string $kind, string|int|null $id): ?array
    {
        if ($id === null) {
            return null;
        }
        $statement = $this->db->prepare('SELECT data FROM records WHERE kind = ? AND id = ?');
        $statement->execute([$kind, (string) $id]);
        $row = $statement->fetch();
        return $row ? json_decode($row['data'], true) : null;
    }

    public function put(string $kind, string|int $id, array $data, ?string $owner = null): array
    {
        $statement = $this->db->prepare(
            'INSERT INTO records (kind, id, owner, data, created_at) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (kind, id) DO UPDATE SET owner = COALESCE(excluded.owner, owner), data = excluded.data'
        );
        $statement->execute([$kind, (string) $id, $owner, Json::encode($data), self::now()]);
        return $data;
    }

    public function delete(string $kind, string $id): void
    {
        $this->db->prepare('DELETE FROM records WHERE kind = ? AND id = ?')->execute([$kind, $id]);
    }

    /** Newest first. */
    public function list(string $kind, ?string $owner = null, bool $filterOwner = false): array
    {
        $sql = 'SELECT data FROM records WHERE kind = ?' . ($filterOwner ? ' AND owner = ?' : '') . ' ORDER BY created_at DESC, rowid DESC';
        $statement = $this->db->prepare($sql);
        $statement->execute($filterOwner ? [$kind, $owner] : [$kind]);
        return array_map(fn ($row) => json_decode($row['data'], true), $statement->fetchAll());
    }

    public function listOwned(string $kind, string $owner): array
    {
        return $this->list($kind, $owner, true);
    }

    /** Runs $work inside BEGIN IMMEDIATE. Nested calls join the open transaction. */
    public function transaction(callable $work): mixed
    {
        if ($this->depth > 0) {
            return $work();
        }
        $this->db->exec('BEGIN IMMEDIATE');
        $this->depth = 1;
        try {
            $result = $work();
            $this->db->exec('COMMIT');
            return $result;
        } catch (\Throwable $error) {
            $this->db->exec('ROLLBACK');
            throw $error;
        } finally {
            $this->depth = 0;
        }
    }

    /** Read-modify-write one record. $mutate receives the record by reference. */
    public function update(string $kind, string $id, callable $mutate): array
    {
        return $this->transaction(function () use ($kind, $id, $mutate) {
            $data = $this->get($kind, $id);
            if ($data === null) {
                throw new \RuntimeException("$kind $id not found");
            }
            $mutate($data);
            return $this->put($kind, $id, $data, $data['owner'] ?? null);
        });
    }

    public function nextNumber(string $counter, int $start): int
    {
        return $this->transaction(function () use ($counter, $start) {
            $next = $this->get('counter', $counter)['next'] ?? $start;
            $this->put('counter', $counter, ['next' => $next + 1]);
            return $next;
        });
    }

    public function keepNewest(string $kind, int $limit): void
    {
        $this->db->prepare(
            'DELETE FROM records WHERE kind = ? AND rowid NOT IN
             (SELECT rowid FROM records WHERE kind = ? ORDER BY created_at DESC, rowid DESC LIMIT ?)'
        )->execute([$kind, $kind, $limit]);
    }
}

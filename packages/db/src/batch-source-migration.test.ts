import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

describe('051_batch_source migration', () => {
  const migrationPath = join(__dirname, '../migrations/051_batch_source.ts');

  test('should exist', async () => {
    await assert.doesNotReject(async () => {
      await readFile(migrationPath, 'utf-8');
    });
  });

  test('should add source column with correct type', async () => {
    const content = await readFile(migrationPath, 'utf-8');
    assert.ok(content.includes("addColumn('source'"));
    assert.ok(/varchar\(30\)/i.test(content));
  });

  test('should backfill studio source by project association first', async () => {
    const content = await readFile(migrationPath, 'utf-8');
    assert.ok(content.includes("UPDATE task_batches"));
    assert.ok(content.includes("source = 'studio'"));
    assert.ok(content.includes("picture_book_project_id IS NOT NULL"));
    assert.ok(content.includes("video_studio_project_id IS NOT NULL"));
  });

  test('should backfill canvas source by association fields', async () => {
    const content = await readFile(migrationPath, 'utf-8');
    assert.ok(content.includes("UPDATE task_batches"));
    assert.ok(content.includes("source = 'canvas'"));
    assert.ok(content.includes("canvas_id IS NOT NULL"));
    assert.ok(content.includes("canvas_node_id IS NOT NULL"));
  });

  test('should backfill studio source by module without overwriting', async () => {
    const content = await readFile(migrationPath, 'utf-8');
    assert.ok(content.includes("source = 'studio'"));
    assert.ok(content.includes("WHERE source = 'generation'"));
    assert.ok(content.includes("module IN ('music','music_voice_clone','picture_book','short_drama')"));
  });

  test('should backfill canvas source by module without overwriting', async () => {
    const content = await readFile(migrationPath, 'utf-8');
    assert.ok(content.includes("source = 'canvas'"));
    assert.ok(content.includes("WHERE source = 'generation'"));
    assert.ok(content.includes("module IN ('agent','storyboard','upload')"));
  });

  test('should backfill generation source for correct modules', async () => {
    const content = await readFile(migrationPath, 'utf-8');
    assert.ok(content.includes("UPDATE task_batches"));
    assert.ok(content.includes("source = 'generation'"));
    assert.ok(content.includes("module IN ('image','video','tts','lipsync','avatar','action_imitation')"));
  });

  test('should include source check constraint', async () => {
    const content = await readFile(migrationPath, 'utf-8');
    assert.ok(content.includes('chk_tb_source'));
    assert.ok(/CHECK.*source.*IN.*\('generation','studio','canvas'\)/i.test(content));
  });

  test('should create source index', async () => {
    const content = await readFile(migrationPath, 'utf-8');
    assert.ok(content.includes('idx_task_batches_source_workspace_created'));
    assert.ok(/CREATE INDEX.*idx_task_batches_source_workspace_created/i.test(content));
    assert.ok(content.includes('source'));
    assert.ok(content.includes('workspace_id'));
    assert.ok(content.includes('created_at'));
  });

  test('should update module check constraint to include all modules', async () => {
    const content = await readFile(migrationPath, 'utf-8');
    assert.ok(content.includes('chk_tb_module'));
    // 应该包含所有模块
    const modules = [
      'image', 'video', 'tts', 'lipsync', 'agent', 'avatar',
      'action_imitation', 'storyboard', 'upload', 'music',
      'music_voice_clone', 'picture_book', 'short_drama'
    ];
    modules.forEach(mod => {
      assert.ok(content.includes(mod));
    });
  });

  test('should have proper down migration', async () => {
    const content = await readFile(migrationPath, 'utf-8');
    assert.ok(content.includes('export async function down'));
    assert.ok(/DROP.*idx_task_batches_source_workspace_created/i.test(content));
    assert.ok(/DROP.*CONSTRAINT.*chk_tb_source/i.test(content));
    assert.ok(/DROP.*COLUMN.*source/i.test(content));
  });
});

describe('054_backfill_batch_source_for_projects migration', () => {
  const migrationPath = join(__dirname, '../migrations/054_backfill_batch_source_for_projects.ts');

  test('should backfill studio source for all project associations', async () => {
    const content = await readFile(migrationPath, 'utf-8');
    assert.ok(content.includes("source = 'studio'"));
    assert.ok(content.includes('short_drama_project_id IS NOT NULL'));
    assert.ok(content.includes('picture_book_project_id IS NOT NULL'));
    assert.ok(content.includes('video_studio_project_id IS NOT NULL'));
  });

  test('should backfill canvas source for canvas associations', async () => {
    const content = await readFile(migrationPath, 'utf-8');
    assert.ok(content.includes("source = 'canvas'"));
    assert.ok(content.includes('canvas_id IS NOT NULL'));
    assert.ok(content.includes('canvas_node_id IS NOT NULL'));
  });
});

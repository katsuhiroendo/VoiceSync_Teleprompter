'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  ScriptItem,
  PrompterSettings,
  DEFAULT_PROMPTER_SETTINGS,
} from '@/types/prompter';
import {
  getAllScripts,
  saveScript,
  deleteScriptById,
  loadPrompterSettings,
  savePrompterSettings,
  DEFAULT_SAMPLE_SCRIPTS,
} from '@/lib/db';
import { ScriptEditorWorkspace } from '@/components/ScriptEditorWorkspace';
import { TeleprompterStage } from '@/components/TeleprompterStage';
import { SettingsModal } from '@/components/SettingsModal';

export default function HomePage() {
  const [scripts, setScripts] = useState<ScriptItem[]>(DEFAULT_SAMPLE_SCRIPTS);
  const [activeScriptId, setActiveScriptId] = useState<string>(
    DEFAULT_SAMPLE_SCRIPTS[0].id
  );
  const [settings, setSettings] = useState<PrompterSettings>(
    DEFAULT_PROMPTER_SETTINGS
  );
  const [mode, setMode] = useState<'edit' | 'stage'>('edit');
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isHydrated, setIsHydrated] = useState<boolean>(false);

  // Initial load from IndexedDB
  useEffect(() => {
    let mounted = true;
    async function init() {
      const [loadedScripts, loadedSettings] = await Promise.all([
        getAllScripts(),
        loadPrompterSettings(),
      ]);
      if (!mounted) return;
      if (loadedScripts.length > 0) {
        setScripts(loadedScripts);
        setActiveScriptId(loadedScripts[0].id);
      }
      setSettings(loadedSettings);
      setIsHydrated(true);
    }
    init();
    return () => {
      mounted = false;
    };
  }, []);

  const activeScript =
    scripts.find((s) => s.id === activeScriptId) || scripts[0];

  const handleUpdateSettings = useCallback(
    (partial: Partial<PrompterSettings>) => {
      setSettings((prev) => {
        const next = { ...prev, ...partial };
        savePrompterSettings(next);
        return next;
      });
    },
    []
  );

  const handleResetSettings = useCallback(() => {
    setSettings(DEFAULT_PROMPTER_SETTINGS);
    savePrompterSettings(DEFAULT_PROMPTER_SETTINGS);
  }, []);

  const handleCreateScript = useCallback(async () => {
    const newScript: ScriptItem = {
      id: `script-${Date.now()}`,
      title: '新規原稿',
      content:
        'ここに新しい原稿を入力してください。\n句点（。）や改行ごとに自動でフレーズ分割されます。',
      language: 'ja-JP',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveScript(newScript);
    setScripts((prev) => [newScript, ...prev]);
    setActiveScriptId(newScript.id);
  }, []);

  const handleUpdateScript = useCallback(async (updated: ScriptItem) => {
    setScripts((prev) =>
      prev.map((item) => (item.id === updated.id ? updated : item))
    );
    await saveScript(updated);
  }, []);

  const handleDuplicateScript = useCallback(async (source: ScriptItem) => {
    const copy: ScriptItem = {
      ...source,
      id: `script-${Date.now()}`,
      title: `${source.title} (コピー)`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveScript(copy);
    setScripts((prev) => [copy, ...prev]);
    setActiveScriptId(copy.id);
  }, []);

  const handleDeleteScript = useCallback(
    async (id: string) => {
      if (scripts.length <= 1) return;
      await deleteScriptById(id);
      setScripts((prev) => {
        const remaining = prev.filter((item) => item.id !== id);
        if (id === activeScriptId && remaining.length > 0) {
          setActiveScriptId(remaining[0].id);
        }
        return remaining;
      });
    },
    [activeScriptId, scripts.length]
  );

  const handleImportScriptFile = useCallback(
    async (title: string, content: string) => {
      const imported: ScriptItem = {
        id: `script-${Date.now()}`,
        title,
        content,
        language: 'ja-JP',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await saveScript(imported);
      setScripts((prev) => [imported, ...prev]);
      setActiveScriptId(imported.id);
    },
    []
  );

  if (!isHydrated) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-zinc-950 text-zinc-400">
        <div className="flex items-center gap-3 text-sm">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" />
          <span>VoiceSync Teleprompter を読み込み中...</span>
        </div>
      </div>
    );
  }

  return (
    <>
      {mode === 'edit' ? (
        <ScriptEditorWorkspace
          scripts={scripts}
          activeScript={activeScript}
          onSelectScript={setActiveScriptId}
          onCreateScript={handleCreateScript}
          onUpdateScript={handleUpdateScript}
          onDuplicateScript={handleDuplicateScript}
          onDeleteScript={handleDeleteScript}
          onImportScriptFile={handleImportScriptFile}
          onStartTeleprompter={() => setMode('stage')}
          onOpenSettings={() => setIsSettingsOpen(true)}
        />
      ) : (
        <TeleprompterStage
          script={activeScript}
          settings={settings}
          onUpdateSettings={handleUpdateSettings}
          onExitStage={() => setMode('edit')}
          onOpenSettings={() => setIsSettingsOpen(true)}
        />
      )}

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onUpdateSettings={handleUpdateSettings}
        onResetSettings={handleResetSettings}
      />
    </>
  );
}

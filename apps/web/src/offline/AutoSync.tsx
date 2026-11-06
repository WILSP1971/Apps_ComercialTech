// src/offline/AutoSync.tsx
'use client';
import { useEffect } from 'react';
import { iniciarMotor } from './motor-sync';

export function AutoSync({ empresaId }: { empresaId: string }) {
  useEffect(() => iniciarMotor(empresaId), [empresaId]);
  return null;
}

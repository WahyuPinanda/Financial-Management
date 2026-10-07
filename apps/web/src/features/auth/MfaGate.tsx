import { useEffect, useRef, useState, type ReactNode, type FormEvent } from 'react';
import { ShieldCheck } from 'lucide-react';
import { LatestRequest } from '@sawit/shared';
import { supabase } from '../../lib/supabase';
import { useAuth } from './AuthProvider';

export function MfaGate({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [state, setState] = useState<{
    token: string;
    factorId: string | null;
    factors: { id: string; name: string }[];
  } | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState(''),
    [retry, setRetry] = useState(0);
  const latest = useRef(new LatestRequest());
  useEffect(() => {
    if (!supabase || !session) return;
    const op = latest.current.begin();
    setError('');
    void (async () => {
      const [level, factors] = await Promise.all([
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
        supabase.auth.mfa.listFactors(),
      ]);
      if (level.error || factors.error || !level.data.currentLevel)
        throw new Error('Keamanan sesi belum dapat diperiksa. Coba lagi.');
      const verified = factors.data.all.filter((f) => f.status === 'verified');
      if (verified.length && level.data.currentLevel !== 'aal2' && !factors.data.totp.length)
        throw new Error('Akun ini memerlukan faktor selain Authenticator. Hubungi pengelola akun.');
      if (op.isCurrent())
        setState({
          token: session.access_token,
          factorId:
            verified.length && level.data.currentLevel !== 'aal2' ? factors.data.totp[0].id : null,
          factors: factors.data.totp.map((factor, index) => ({
            id: factor.id,
            name: factor.friendly_name || `Authenticator ${index + 1}`,
          })),
        });
    })().catch(() => {
      if (op.isCurrent())
        setError('Keamanan sesi belum dapat diperiksa. Coba lagi atau masuk ulang.');
    });
    return () => latest.current.cancel();
  }, [session?.access_token, retry]);
  if (error)
    return (
      <main className="mfa-screen">
        <section className="panel finance-panel">
          <div className="alert error" role="alert">
            {error}
          </div>
          <button className="button primary" onClick={() => setRetry((v) => v + 1)}>
            Coba lagi
          </button>{' '}
          <button
            className="button secondary"
            onClick={() => void supabase?.auth.signOut({ scope: 'local' })}
          >
            Keluar
          </button>
        </section>
      </main>
    );
  if (!state || state.token !== session?.access_token)
    return (
      <div className="app-loading" role="status">
        Memeriksa keamanan sesi…
      </div>
    );
  if (state.factorId)
    return (
      <main className="mfa-screen">
        <section className="panel finance-panel">
          <ShieldCheck size={32} />
          <h1>Verifikasi dua langkah</h1>
          <p>Masukkan kode dari aplikasi Authenticator untuk membuka keuangan Anda.</p>
          {state.factors.length > 1 && (
            <label className="mfa-device-label">
              Perangkat Authenticator
              <select
                value={state.factorId}
                disabled={verifying}
                onChange={(e) =>
                  setState((current) =>
                    current ? { ...current, factorId: e.target.value } : current,
                  )
                }
              >
                {state.factors.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <MfaCode
            key={state.factorId}
            factorId={state.factorId}
            onBusyChange={setVerifying}
            onVerified={() => setRetry((v) => v + 1)}
          />
          <p className="form-note">
            Kehilangan perangkat? Hubungi pengelola akun untuk pemulihan identitas. Reset password
            tidak menonaktifkan MFA.
          </p>
          <button
            className="button secondary"
            disabled={verifying}
            onClick={() => void supabase?.auth.signOut({ scope: 'local' })}
          >
            Keluar
          </button>
        </section>
      </main>
    );
  return children;
}

export function MfaCode({
  factorId,
  onVerified,
  label = 'Verifikasi',
  busy: outerBusy = false,
  onBusyChange,
}: {
  factorId: string;
  onVerified: () => void | Promise<void>;
  label?: string;
  busy?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [code, setCode] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const submitting = useRef(false);
  async function verify(e: FormEvent) {
    e.preventDefault();
    if (!supabase || submitting.current || outerBusy) return;
    submitting.current = true;
    setBusy(true);
    onBusyChange?.(true);
    setError('');
    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
      if (error)
        throw new Error(
          'Kode tidak valid atau kedaluwarsa. Gunakan kode terbaru dari Authenticator.',
        );
      setCode('');
      await onVerified();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Verifikasi gagal. Coba lagi.');
    } finally {
      submitting.current = false;
      setBusy(false);
      onBusyChange?.(false);
    }
  }
  return (
    <form className="modal-form" onSubmit={verify}>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      <label>
        Kode Authenticator
        <input
          autoFocus
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          minLength={6}
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          required
          disabled={busy || outerBusy}
        />
      </label>
      <button className="button primary" disabled={busy || outerBusy}>
        {busy ? 'Memverifikasi…' : label}
      </button>
    </form>
  );
}

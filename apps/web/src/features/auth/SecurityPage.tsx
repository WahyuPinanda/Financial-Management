import { useEffect, useRef, useState } from 'react';
import type { Factor } from '@supabase/supabase-js';
import { ShieldCheck } from 'lucide-react';
import { LatestRequest } from '@sawit/shared';
import { supabase } from '../../lib/supabase';
import { errorMessage } from '../../lib/format';
import { MfaCode } from './MfaGate';
export function SecurityPage({ preview }: { preview: boolean }) {
  const [factors, setFactors] = useState<Factor[]>([]),
    [enrollment, setEnrollment] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [loaded, setLoaded] = useState(preview);
  const latest = useRef(new LatestRequest()),
    working = useRef(false);
  async function load() {
    if (preview || !supabase) return;
    const op = latest.current.begin();
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (!op.isCurrent()) return;
    if (error) throw new Error('Daftar Authenticator belum dapat dimuat.');
    setFactors(data.all);
    setLoaded(true);
  }
  useEffect(() => {
    void load().catch((e) => setError(errorMessage(e)));
    return () => latest.current.cancel();
  }, [preview]);
  async function action(operation: () => Promise<void>) {
    if (working.current || preview) return;
    working.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await operation();
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  async function enroll() {
    if (!supabase) return;
    await action(async () => {
      // Pending factors have no recoverable QR after reload; remove only unverified ones.
      for (const factor of factors.filter(
        (f) => f.status === 'unverified' && f.factor_type === 'totp',
      )) {
        const { error } = await supabase!.auth.mfa.unenroll({ factorId: factor.id });
        if (error) throw new Error('Pendaftaran sebelumnya belum dapat dibersihkan.');
      }
      const { data, error } = await supabase!.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: `Cash Flow ${new Date().toISOString().slice(0, 19)}`,
        issuer: 'Cash Flow',
      });
      if (error || data.type !== 'totp')
        throw new Error('Authenticator belum dapat didaftarkan. Coba lagi.');
      setEnrollment({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    });
  }
  const verified = factors.filter((f) => f.status === 'verified');
  return (
    <section className="panel finance-panel security-panel">
      <div className="panel-heading">
        <div>
          <h2>Keamanan akun</h2>
          <p>Tambahkan Authenticator untuk melindungi data keuangan.</p>
        </div>
        <ShieldCheck size={28} />
      </div>
      {preview && (
        <div className="notice">
          Pratinjau keamanan akun. Pendaftaran dan verifikasi tersedia setelah login ke Supabase.
        </div>
      )}
      {error && (
        <div className="alert error" role="alert">
          {error}
          {!loaded && (
            <button
              className="text-button"
              onClick={() => void load().catch((e) => setError(errorMessage(e)))}
            >
              Coba lagi
            </button>
          )}
        </div>
      )}
      {notice && (
        <div className="alert success" role="status">
          {notice}
        </div>
      )}
      <p>
        <strong>
          {!loaded ? 'Memeriksa Authenticator…' : verified.length ? 'MFA aktif' : 'MFA belum aktif'}
        </strong>{' '}
        · Kode berubah secara berkala di aplikasi Authenticator.
      </p>
      {!enrollment && !removing && (
        <button
          className="button primary"
          disabled={busy || !loaded || preview || !supabase || verified.length >= 2}
          onClick={() => void enroll()}
        >
          Tambah Authenticator
        </button>
      )}
      {verified.map((f) => (
        <div className="security-factor" key={f.id}>
          <span>{f.friendly_name || 'Authenticator'}</span>
          <button
            className="button secondary compact"
            disabled={busy || Boolean(enrollment)}
            onClick={() => setRemoving(f.id)}
          >
            Hapus Authenticator
          </button>
        </div>
      ))}
      {enrollment && (
        <div className="mfa-enrollment">
          <h3>Daftarkan perangkat</h3>
          <p>Pindai QR dengan aplikasi Authenticator atau masukkan kunci secara manual.</p>
          <img
            className="mfa-qr"
            src={
              enrollment.qr.startsWith('data:')
                ? enrollment.qr
                : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(enrollment.qr)}`
            }
            alt="QR pendaftaran Authenticator"
          />
          <details>
            <summary>Tampilkan kunci manual</summary>
            <code>{enrollment.secret}</code>
          </details>
          <MfaCode
            factorId={enrollment.id}
            busy={busy}
            onBusyChange={setBusy}
            label="Aktifkan MFA"
            onVerified={async () => {
              setEnrollment(null);
              setNotice('Authenticator aktif. Simpan akses perangkat Anda dengan aman.');
              await load();
            }}
          />
          <button
            className="button secondary"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                const { error } = await supabase!.auth.mfa.unenroll({ factorId: enrollment.id });
                if (error) throw new Error('Pendaftaran belum dapat dibatalkan.');
                setEnrollment(null);
              })
            }
          >
            Batalkan pendaftaran
          </button>
        </div>
      )}
      {removing && (
        <div className="notice">
          <h3>Konfirmasi penghapusan</h3>
          <p>
            {verified.length === 1
              ? 'Menghapus Authenticator terakhir akan menonaktifkan login dua langkah.'
              : 'Authenticator ini akan dihapus.'}{' '}
            Masukkan kode dari perangkat yang akan dihapus.
          </p>
          <MfaCode
            factorId={removing}
            busy={busy}
            onBusyChange={setBusy}
            label="Verifikasi dan hapus"
            onVerified={async () => {
              const { error } = await supabase!.auth.mfa.unenroll({ factorId: removing });
              if (error) throw new Error('Authenticator belum dapat dihapus.');
              setRemoving(null);
              setNotice('Authenticator berhasil dihapus.');
              await load();
            }}
          />
          <button className="button secondary" disabled={busy} onClick={() => setRemoving(null)}>
            Batal
          </button>
        </div>
      )}
      <p className="form-note">
        Simpan akses cadangan ke aplikasi Authenticator. Untuk perangkat hilang, pemulihan dilakukan
        melalui pengelola Supabase setelah verifikasi identitas.
      </p>
    </section>
  );
}

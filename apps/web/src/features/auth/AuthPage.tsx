import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ArrowRight, ArrowLeft, Check, Eye, EyeOff, Leaf } from 'lucide-react';
import { Brand } from '../../components/Brand';
import { supabase } from '../../lib/supabase';
import { errorMessage } from '../../lib/format';
import { useAuth } from './AuthProvider';

type Mode = 'login' | 'forgot' | 'reset';
const content = {
  login: {
    tag: 'SELAMAT DATANG KEMBALI',
    title: 'Hasil terpantau.\nKeuangan tertata.',
    description: 'Masuk untuk melihat hasil kerja kebun Anda.',
    button: 'Masuk ke dashboard',
  },
  forgot: {
    tag: 'PEMULIHAN AKUN',
    title: 'Lupa password?',
    description: 'Kami akan mengirim tautan untuk membuat password baru ke email Anda.',
    button: 'Kirim tautan pemulihan',
  },
  reset: {
    tag: 'PASSWORD BARU',
    title: 'Mulai dengan aman.',
    description: 'Buat password baru minimal 8 karakter untuk akun Anda.',
    button: 'Simpan password baru',
  },
};

export function AuthPage({ mode }: { mode: Mode }) {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const c = content[mode];
  const linkError =
    new URLSearchParams(window.location.hash.slice(1)).get('error_description') ||
    new URLSearchParams(window.location.search).get('error_description');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error)
          throw new Error(
            error.code === 'invalid_credentials'
              ? 'Email atau password salah.'
              : error.code === 'email_not_confirmed'
                ? 'Konfirmasi email Anda terlebih dahulu.'
                : 'Login gagal. Silakan coba lagi.',
          );
        navigate('/dashboard', { replace: true });
      } else if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw new Error('Tautan belum berhasil dikirim. Coba lagi beberapa saat.');
        setMessage(
          'Jika email terdaftar, tautan pemulihan akan dikirim. Periksa kotak masuk dan folder spam.',
        );
      } else {
        if (!session)
          throw new Error(
            'Tautan tidak valid atau telah kedaluwarsa. Minta tautan pemulihan baru.',
          );
        if (password !== confirmation) throw new Error('Konfirmasi password belum cocok.');
        const { error } = await supabase.auth.updateUser({ password });
        if (error)
          throw new Error(
            'Password belum dapat diperbarui. Gunakan password yang berbeda atau minta tautan baru.',
          );
        await supabase.auth.signOut({ scope: 'local' });
        setPassword('');
        setConfirmation('');
        setMessage('Password diperbarui. Silakan masuk menggunakan password baru Anda.');
      }
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  if (mode === 'login' && session && !loading) return <Navigate to="/dashboard" replace />;
  return (
    <main className="auth-layout">
      <section className="auth-story">
        <Brand light />
        <div className="story-body">
          <span className="eyebrow">DARI HASIL, UNTUK MASA DEPAN</span>
          <h1>
            Setiap hasil
            <br />
            punya cerita.
            <br />
            <span>Catat hasilnya.</span>
          </h1>
          <p>
            Satu tempat untuk mencatat pendapatan, memahami hasil, dan merencanakan
            langkah berikutnya.
          </p>
          <div className="story-illustration" aria-hidden="true">
            <div className="leaf leaf-one" />
            <div className="leaf leaf-two" />
            <div className="leaf leaf-three" />
            <div className="leaf leaf-four" />
            <div className="plant-stem" />
            <div className="plant-ground" />
          </div>
          <div className="story-note">
            <span className="story-note-icon">
              <Leaf size={21} />
            </span>
            <div>
              <strong>Lebih jelas. Lebih terencana.</strong>
              <span>Perhitungan otomatis.</span>
            </div>
          </div>
        </div>
        <div className="story-footer">CASH FLOW · MANAJEMEN KEUANGAN</div>
      </section>
      <section className="auth-panel">
        <div className="auth-mobile-brand">
          <Brand />
        </div>
        <div className="auth-form-wrap">
          <span className="eyebrow">{c.tag}</span>
          <h2>{c.title}</h2>
          <p className="auth-description">{c.description}</p>
          {!supabase && (
            <div className="notice">
              Aplikasi belum terhubung ke Supabase. Login akan aktif setelah konfigurasi proyek
              selesai.
            </div>
          )}
          {(error || linkError) && (
            <div className="alert error" role="alert">
              {error || 'Tautan pemulihan tidak valid atau kedaluwarsa. Minta tautan baru.'}
            </div>
          )}
          {message && (
            <div className="alert success" role="status">
              <Check size={18} />
              {message}
            </div>
          )}
          {mode === 'reset' && !loading && !session && !message && (
            <div className="notice">
              Buka halaman ini dari tautan pemulihan email.{' '}
              <Link to="/forgot-password">Kirim ulang tautan</Link>
            </div>
          )}
          <form onSubmit={submit} className="auth-form">
            {mode !== 'reset' && (
              <label>
                Email
                <input
                  type="email"
                  placeholder="nama@email.com"
                  autoComplete="email"
                  required
                  maxLength={254}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={busy}
                />
              </label>
            )}
            {mode !== 'forgot' && (
              <label>
                <span className="label-row">
                  Password{mode === 'login' && <Link to="/forgot-password">Lupa password?</Link>}
                </span>
                <div className="password-input">
                  <input
                    type={visible ? 'text' : 'password'}
                    placeholder={mode === 'reset' ? 'Minimal 8 karakter' : 'Masukkan password Anda'}
                    autoComplete={mode === 'reset' ? 'new-password' : 'current-password'}
                    minLength={mode === 'reset' ? 8 : 1}
                    maxLength={128}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={busy}
                  />
                  <button
                    type="button"
                    aria-label={visible ? 'Sembunyikan password' : 'Tampilkan password'}
                    onClick={() => setVisible(!visible)}
                  >
                    {visible ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </label>
            )}
            {mode === 'reset' && (
              <label>
                Konfirmasi password
                <input
                  type={visible ? 'text' : 'password'}
                  required
                  minLength={8}
                  maxLength={128}
                  autoComplete="new-password"
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  disabled={busy}
                />
              </label>
            )}
            <button
              className="button primary auth-submit"
              disabled={
                busy || loading || !supabase || (mode === 'reset' && (!session || Boolean(message)))
              }
            >
              {busy ? 'Memproses…' : c.button}
              <ArrowRight size={18} />
            </button>
          </form>
          {mode !== 'login' && (
            <Link className="back-link" to="/login">
              <ArrowLeft size={16} /> Kembali ke halaman login
            </Link>
          )}
          {!supabase && import.meta.env.DEV && (
            <Link className="preview-link" to="/preview">
              Lihat pratinjau dashboard →
            </Link>
          )}
        </div>
        <p className="auth-footer">Tumbuh bersama Cash Flow</p>
      </section>
    </main>
  );
}

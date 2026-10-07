import { Component, type ErrorInfo, type ReactNode } from 'react';

export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    // Avoid logging financial values or form contents to telemetry.
    console.error('Tampilan aplikasi gagal dimuat.');
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="app-loading" role="alert">
        <div>
          <h1>Tampilan belum dapat dimuat.</h1>
          <p>
            Muat ulang untuk membaca data terbaru. Isian yang belum disimpan perlu diisi kembali.
          </p>
          <button className="button primary" onClick={() => window.location.reload()}>
            Muat ulang aplikasi
          </button>
        </div>
      </main>
    );
  }
}

import AppHeader from '@/components/AppHeader';
import ShiftBanner from '@/components/ShiftBanner';
import AuthGate from '@/components/auth/AuthGate';

export default function PosLayout({ children }) {
  return (
    <div className="app-shell">
      <AppHeader />
      <ShiftBanner />
      <main className="app-main">
        <AuthGate>{children}</AuthGate>
      </main>
    </div>
  );
}

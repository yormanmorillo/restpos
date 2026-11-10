import AppHeader from '@/components/AppHeader';

export default function PosLayout({ children }) {
  return (
    <div className="app-shell">
      <AppHeader />
      <main className="app-main">{children}</main>
    </div>
  );
}

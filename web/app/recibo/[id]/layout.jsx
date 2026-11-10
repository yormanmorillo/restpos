import AuthGate from '@/components/auth/AuthGate';

export default function ReceiptLayout({ children }) {
  return <AuthGate>{children}</AuthGate>;
}

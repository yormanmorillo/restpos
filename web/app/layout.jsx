import './globals.css';
import { AuthProvider } from '@/components/auth/AuthProvider';
import DevelopedBy from '@/components/DevelopedBy';

export const metadata = {
  title: {
    default: 'Casa Roble POS',
    template: '%s · Casa Roble POS',
  },
  description: 'Punto de venta moderno para restaurantes. Pedidos, cocina, caja y reportes.',
  icons: { icon: '/matmax-logo.jpeg' },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#111111',
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>
        <AuthProvider>{children}</AuthProvider>
        <DevelopedBy />
      </body>
    </html>
  );
}

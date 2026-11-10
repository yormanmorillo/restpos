import './globals.css';

export const metadata = {
  title: {
    default: 'Casa Roble POS',
    template: '%s · Casa Roble POS',
  },
  description: 'Punto de venta táctil para restaurantes. Pedidos, mesas, cobros y reportes.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#1f3a2e',
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}

import OwnerNav from '@/components/owner/OwnerNav';

export default function OwnerLayout({ children }) {
  return (
    <>
      <OwnerNav />
      {children}
    </>
  );
}

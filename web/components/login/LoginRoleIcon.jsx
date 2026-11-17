'use client';

const THEMES = {
  waiter: { bg: '#f4e3d7', ring: '#c45d3a' },
  chef: { bg: '#e7efe9', ring: '#3f7d6a' },
  cash: { bg: '#f6ecd2', ring: '#b8893a' },
  admin: { bg: '#e5ebf0', ring: '#3e5d72' },
  crown: { bg: '#f1e3c1', ring: '#b07a24' },
  users: { bg: '#ece7df', ring: '#8b7a68' },
};

function Waiter() {
  return (
    <>
      <circle cx="32" cy="27" r="9" fill="#e7b48f" />
      <path d="M23 26c1-7 5-10 10-10 7 0 11 5 11 13-4-4-8-5-12-5-4 0-6 1-9 2Z" fill="#3a2a24" />
      <path d="M23 27c1 5 4 8 9 8s8-3 9-8c-3-3-7-4-9-4s-6 1-9 4Z" fill="#e7b48f" />
      <circle cx="28.5" cy="28" r="1.2" fill="#3a2a24" />
      <circle cx="36" cy="28" r="1.2" fill="#3a2a24" />
      <path d="M29 32c2 1.5 4 1.5 6 0" stroke="#8a4a37" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M15 56c1-10 7-15 17-15s16 5 17 15" fill="#fffaf4" stroke="#d8c7b5" strokeWidth="1.5" />
      <path d="M26 42l6 5 6-5-3-3h-6Z" fill="#c45d3a" />
      <path d="M31 45h2v9h-2z" fill="#c45d3a" />
      <rect x="39" y="36" width="17" height="4" rx="2" fill="#3a2a24" />
      <path d="M42 36c0-5 2-8 5.5-8s5.5 3 5.5 8" fill="#fff" stroke="#3a2a24" strokeWidth="1.5" />
      <path d="M45 25c1-3 4-3 5 0M43 22c0-2 2-3 4-3" stroke="#b8893a" strokeWidth="1.5" strokeLinecap="round" />
    </>
  );
}

function Chef() {
  return (
    <>
      <path d="M17 30c-5-2-6-9-2-12 2-2 5-2 7-1 1-5 6-8 11-8s10 3 11 8c3-1 6 0 7 3 2 4-1 9-6 10v6H17Z" fill="#fffdf8" stroke="#d8c7b5" strokeWidth="1.5" />
      <path d="M18 34h28v5H18Z" fill="#e9dfd2" />
      <circle cx="32" cy="43" r="9" fill="#e7b48f" />
      <path d="M23 42c0-6 4-9 9-9s9 3 9 9" fill="#4a3428" />
      <circle cx="28" cy="43" r="1.2" fill="#3a2a24" />
      <circle cx="36" cy="43" r="1.2" fill="#3a2a24" />
      <path d="M29 47c2 1.5 4 1.5 6 0" stroke="#8a4a37" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M20 58c1-6 5-9 12-9s11 3 12 9" fill="#fffaf4" stroke="#d8c7b5" strokeWidth="1.5" />
      <path d="M26 51l6 4 6-4" fill="none" stroke="#c45d3a" strokeWidth="2" />
      <path d="M46 21c2-2 5-1 5 1s-3 3-5 1Z" fill="#3f7d6a" />
    </>
  );
}

function Cashier() {
  return (
    <>
      <rect x="11" y="23" width="42" height="29" rx="4" fill="#3f7d6a" />
      <rect x="15" y="27" width="34" height="17" rx="2" fill="#f9f5ec" />
      <path d="M19 31h12M19 35h8" stroke="#3f7d6a" strokeWidth="2" strokeLinecap="round" />
      <rect x="38" y="29" width="7" height="7" rx="1" fill="#b8893a" />
      <rect x="15" y="47" width="34" height="5" rx="1.5" fill="#2d5e50" />
      <circle cx="32" cy="49.5" r="1.4" fill="#f4e3d7" />
      <circle cx="48" cy="18" r="8" fill="#f1c75b" />
      <path d="M48 14v8M45 16.5c0-1.4 1.2-2.2 3-2.2 2 0 3 .8 3 2.1 0 3-6 1.6-6 4.4 0 1.4 1.2 2.2 3 2.2 2 0 3-.8 3-2.2" stroke="#8a5c13" strokeWidth="1.5" fill="none" />
      <path d="M9 52h10l-2 5H11Z" fill="#d8c7b5" />
    </>
  );
}

function Admin() {
  return (
    <>
      <circle cx="30" cy="25" r="9" fill="#e7b48f" />
      <path d="M21 24c1-6 5-9 10-9 6 0 9 4 10 10-4-3-7-4-11-4-4 0-6 1-9 3Z" fill="#3a2a24" />
      <rect x="21" y="24" width="7" height="5" rx="2" fill="none" stroke="#3e5d72" strokeWidth="1.4" />
      <rect x="32" y="24" width="7" height="5" rx="2" fill="none" stroke="#3e5d72" strokeWidth="1.4" />
      <path d="M28 26h4" stroke="#3e5d72" strokeWidth="1.4" />
      <circle cx="24.5" cy="26.5" r="1.1" fill="#3a2a24" />
      <circle cx="35.5" cy="26.5" r="1.1" fill="#3a2a24" />
      <path d="M28 31c2 1.3 4 1.3 6 0" stroke="#8a4a37" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M13 58c1-10 7-15 18-15s17 5 18 15" fill="#3e5d72" />
      <path d="M27 43l4 7 4-7" fill="#fffaf4" />
      <path d="M31 47h3l1 11h-5Z" fill="#c45d3a" />
      <rect x="44" y="33" width="13" height="17" rx="2" fill="#fffaf4" stroke="#3e5d72" strokeWidth="1.5" />
      <path d="M47 38h7M47 42h7M47 46h4" stroke="#3e5d72" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M48 31l2-3 2 3" fill="#b8893a" />
    </>
  );
}

function Owner() {
  return (
    <>
      <path d="M13 26l8 6 7-12 8 12 7-6-3 19H16Z" fill="#e7b84d" stroke="#a9771f" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M18 45h30v5H18Z" fill="#c08a2a" />
      <circle cx="21" cy="28" r="2" fill="#fff4cf" />
      <circle cx="32" cy="24" r="2" fill="#fff4cf" />
      <circle cx="42" cy="28" r="2" fill="#fff4cf" />
      <circle cx="32" cy="49" r="4" fill="#3f7d6a" />
      <circle cx="23" cy="51" r="3" fill="#c45d3a" />
      <circle cx="41" cy="51" r="3" fill="#3e5d72" />
      <path d="M25 18l3-5 4 4 4-4 3 5" fill="none" stroke="#e7b84d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </>
  );
}

function Generic() {
  return (
    <>
      <circle cx="32" cy="25" r="10" fill="#d8c7b5" />
      <path d="M17 58c1-11 7-17 15-17s14 6 15 17" fill="#b7a797" />
      <path d="M32 41v17M24 48h16" stroke="#fffaf4" strokeWidth="2" strokeLinecap="round" />
    </>
  );
}

const SHAPES = { waiter: Waiter, chef: Chef, cash: Cashier, admin: Admin, crown: Owner, users: Generic };

export default function LoginRoleIcon({ name = 'users', size = 44 }) {
  const Shape = SHAPES[name] ?? Generic;
  const theme = THEMES[name] ?? THEMES.users;
  return (
    <span className="login-role-icon" style={{ width: size, height: size, background: theme.bg, borderColor: theme.ring }} aria-hidden="true">
      <svg viewBox="0 0 64 64" width={size} height={size} role="presentation">
        <Shape />
      </svg>
    </span>
  );
}

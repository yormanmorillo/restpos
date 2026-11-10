export default function Icon({ name, size = 24, className = '', strokeWidth = 1.8 }) {
  const paths = {
    pos: (
      <>
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <path d="M8 7h8M8 11h3M8 15h3M15 11v6M13 13h4" />
      </>
    ),
    history: (
      <>
        <path d="M3 12a9 9 0 1 0 3-6.7" />
        <path d="M3 4v5h5M12 7v5l3 2" />
      </>
    ),
    admin: (
      <>
        <path d="M4 6h16M4 12h16M4 18h10" />
        <circle cx="8" cy="6" r="1.5" fill="currentColor" stroke="none" />
        <circle cx="16" cy="12" r="1.5" fill="currentColor" stroke="none" />
        <circle cx="13" cy="18" r="1.5" fill="currentColor" stroke="none" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    minus: <path d="M5 12h14" />,
    trash: (
      <>
        <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5" />
      </>
    ),
    note: (
      <>
        <path d="M5 4h14v12l-4 4H5z" />
        <path d="M15 20v-4h4M8 9h8M8 13h5" />
      </>
    ),
    close: <path d="M6 6l12 12M18 6L6 18" />,
    arrowLeft: <path d="M19 12H5M11 18l-6-6 6-6" />,
    printer: (
      <>
        <path d="M7 8V3h10v5M7 17H4a1 1 0 0 1-1-1V9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v7a1 1 0 0 1-1 1h-3" />
        <rect x="7" y="14" width="10" height="7" rx="1" />
        <path d="M17 11h.01" />
      </>
    ),
    check: <path d="M4 12.5l5 5L20 6.5" />,
    cash: (
      <>
        <rect x="2.5" y="6" width="19" height="12" rx="2" />
        <circle cx="12" cy="12" r="2.5" />
        <path d="M6 9.5h.01M18 14.5h.01" />
      </>
    ),
    card: (
      <>
        <rect x="2.5" y="5" width="19" height="14" rx="2" />
        <path d="M2.5 10h19M6 15h4" />
      </>
    ),
    wallet: (
      <>
        <path d="M4 6h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h12" />
        <path d="M16 13h4v4h-4a2 2 0 0 1 0-4Z" />
      </>
    ),
    table: (
      <>
        <path d="M3 9h18M5 9v4M19 9v4M7 9V5h10v4M6 20v-5M18 20v-5M3 15h18" />
      </>
    ),
    users: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 20v-2a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v2M16 4a3 3 0 0 1 0 6M18 14a4 4 0 0 1 3 4v2" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3.5 2" />
      </>
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-4-4" />
      </>
    ),
    edit: (
      <>
        <path d="M4 20h4L20 8l-4-4L4 16v4Z" />
        <path d="M14.5 5.5l4 4" />
      </>
    ),
    tag: (
      <>
        <path d="M3 12V4h8l10 10-8 8L3 12Z" />
        <circle cx="7.5" cy="8.5" r="1.2" fill="currentColor" stroke="none" />
      </>
    ),
    chevronRight: <path d="M9 5l7 7-7 7" />,
    refresh: (
      <>
        <path d="M20 11a8 8 0 1 0-2.3 6.3" />
        <path d="M20 4v7h-7" />
      </>
    ),
    alert: (
      <>
        <path d="M12 3 2.5 20h19L12 3Z" />
        <path d="M12 9v5M12 17.2v.1" />
      </>
    ),
    save: (
      <>
        <path d="M5 3h12l3 3v15H4V3h1Z" />
        <path d="M8 3v6h8V3M8 21v-7h8v7" />
      </>
    ),
    bag: (
      <>
        <path d="M5 8h14l1 13H4L5 8Z" />
        <path d="M9 8V6a3 3 0 0 1 6 0v2" />
      </>
    ),
    receipt: (
      <>
        <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
        <path d="M9 8h6M9 12h6M9 16h3" />
      </>
    ),
    percent: (
      <>
        <path d="M19 5 5 19" />
        <circle cx="7.5" cy="7.5" r="2.5" />
        <circle cx="16.5" cy="16.5" r="2.5" />
      </>
    ),
    coin: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v10M9.5 9.3c0-1 1-1.8 2.5-1.8s2.5.8 2.5 1.8-1 1.7-2.5 1.7-2.5.8-2.5 1.8 1 1.7 2.5 1.7 2.5-.8 2.5-1.7" />
      </>
    ),
    leaf: (
      <>
        <path d="M20 4c-8 0-14 4-14 10 0 3 2 5 5 5 6 0 9-7 9-15Z" />
        <path d="M4 21c1-5 5-9 10-11" />
      </>
    ),
    x: <path d="M6 6l12 12M18 6L6 18" />,
    send: (
      <>
        <path d="M21 3 3 10l7 3 3 7 8-17Z" />
        <path d="M21 3 10 13" />
      </>
    ),
    chef: (
      <>
        <path d="M7 13a4 4 0 1 1 2.2-7.3A4 4 0 0 1 17 7a4 4 0 1 1 0 6v6H7v-6Z" />
        <path d="M7 19h10M9 22h6" />
      </>
    ),
    chevronDown: <path d="M6 9l6 6 6-6" />,
    download: (
      <>
        <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
      </>
    ),
    logout: (
      <>
        <path d="M10 4H5v16h5M14 8l4 4-4 4M18 12H9" />
      </>
    ),
    phone: (
      <>
        <path d="M5 4h4l2 5-2.5 1.5a15 15 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />
      </>
    ),
    pin: (
      <>
        <path d="M12 21s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Z" />
        <circle cx="12" cy="9" r="2.5" />
      </>
    ),
    lock: (
      <>
        <rect x="5" y="10" width="14" height="11" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4v-.2a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
      </>
    ),
    sliders: (
      <>
        <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
        <circle cx="16" cy="7" r="2" />
        <circle cx="8" cy="17" r="2" />
      </>
    ),
    split: (
      <>
        <path d="M6 4v5a3 3 0 0 0 3 3h9" />
        <path d="M6 20v-5a3 3 0 0 1 3-3h9" />
        <path d="M15 9l3 3-3 3M15 15l3-3-3-3" />
      </>
    ),
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {paths[name] ?? paths.alert}
    </svg>
  );
}

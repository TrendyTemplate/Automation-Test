// Presets so users only need email + password (or app password) for popular providers.
export const PROVIDERS = {
  gmail: {
    name: 'Gmail / Google Workspace', imap_host: 'imap.gmail.com', imap_port: 993, imap_secure: true,
    smtp_host: 'smtp.gmail.com', smtp_port: 465, smtp_secure: true,
    help: 'Enable 2-Step Verification, then create an App Password at myaccount.google.com/apppasswords',
  },
  outlook: {
    name: 'Outlook / Hotmail / Microsoft 365', imap_host: 'outlook.office365.com', imap_port: 993, imap_secure: true,
    smtp_host: 'smtp.office365.com', smtp_port: 587, smtp_secure: false,
    help: 'IMAP must be enabled. Microsoft 365 tenants may require an admin to allow IMAP/SMTP AUTH.',
  },
  yahoo: {
    name: 'Yahoo Mail', imap_host: 'imap.mail.yahoo.com', imap_port: 993, imap_secure: true,
    smtp_host: 'smtp.mail.yahoo.com', smtp_port: 465, smtp_secure: true,
    help: 'Generate an App Password in Yahoo Account Security.',
  },
  icloud: {
    name: 'iCloud Mail', imap_host: 'imap.mail.me.com', imap_port: 993, imap_secure: true,
    smtp_host: 'smtp.mail.me.com', smtp_port: 587, smtp_secure: false,
    help: 'Create an app-specific password at appleid.apple.com.',
  },
  zoho: {
    name: 'Zoho Mail', imap_host: 'imap.zoho.com', imap_port: 993, imap_secure: true,
    smtp_host: 'smtp.zoho.com', smtp_port: 465, smtp_secure: true,
    help: 'Enable IMAP access in Zoho Mail settings; use an app password if 2FA is on.',
  },
  yandex: {
    name: 'Yandex Mail', imap_host: 'imap.yandex.com', imap_port: 993, imap_secure: true,
    smtp_host: 'smtp.yandex.com', smtp_port: 465, smtp_secure: true,
    help: 'Enable IMAP in settings and create an app password.',
  },
  custom: {
    name: 'Custom domain / cPanel / other IMAP', imap_host: '', imap_port: 993, imap_secure: true,
    smtp_host: '', smtp_port: 465, smtp_secure: true,
    help: 'Use the IMAP/SMTP settings from your hosting provider (often mail.yourdomain.com).',
  },
};

export function guessProvider(email) {
  const domain = String(email).split('@')[1]?.toLowerCase() || '';
  if (['gmail.com', 'googlemail.com'].includes(domain)) return 'gmail';
  if (['outlook.com', 'hotmail.com', 'live.com', 'msn.com'].includes(domain)) return 'outlook';
  if (domain.startsWith('yahoo.') || domain === 'ymail.com') return 'yahoo';
  if (['icloud.com', 'me.com', 'mac.com'].includes(domain)) return 'icloud';
  if (domain.startsWith('zoho')) return 'zoho';
  if (domain.startsWith('yandex.')) return 'yandex';
  return 'custom';
}

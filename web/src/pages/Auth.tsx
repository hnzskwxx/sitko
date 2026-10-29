import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { ROLE_LABEL, type Role } from '@shared/types';
import { api, ApiFailure } from '../api';
import { Button, ErrorState, Field, Input, Logo, Spinner } from '../components/ui';
import { useDocumentTitle } from '../hooks';

function AuthLayout({ title, children, foot }: { title: string; children: ReactNode; foot?: ReactNode }) {
  useDocumentTitle(title);
  return (
    <main className="auth">
      <div className="auth-card">
        <div className="brand"><Logo size={28} /><span className="brand-name">Sítko</span></div>
        <h1 className="auth-title">{title}</h1>
        {children}
        {foot && <p className="auth-foot">{foot}</p>}
      </div>
    </main>
  );
}

function useForm<T extends Record<string, string>>(initial: T) {
  const [values, setValues] = useState(initial);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const bind = (k: keyof T & string) => ({
    value: values[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setValues((v) => ({ ...v, [k]: e.target.value })),
    invalid: Boolean(fields[k]),
  });
  const submit = (fn: (v: T) => Promise<void>) => async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null); setFields({});
    try {
      await fn(values);
    } catch (err) {
      if (err instanceof ApiFailure) { setFields(err.fields); setError(err.message); }
      else setError('Něco se nepovedlo. Zkuste to znovu.');
    } finally {
      setBusy(false);
    }
  };
  return { values, setValues, fields, error, busy, bind, submit };
}

export function LoginPage() {
  const qc = useQueryClient();
  const f = useForm({ email: '', password: '' });
  const demo = useQuery({
    queryKey: ['demo-login'],
    queryFn: () => api.get<{ email: string; password: string } | null>('/auth/demo'),
    staleTime: 60_000,
  });
  const registration = useQuery({
    queryKey: ['registration'],
    queryFn: () => api.get<{ open: boolean; codeRequired: boolean }>('/auth/registration'),
    staleTime: 60_000,
  });
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoError, setDemoError] = useState<string | null>(null);
  const openDemo = async () => {
    if (!demo.data) return;
    setDemoBusy(true); setDemoError(null);
    try {
      await api.post('/auth/login', demo.data);
      await qc.invalidateQueries({ queryKey: ['me'] });
    } catch (err) {
      setDemoError(err instanceof ApiFailure ? err.message : 'Ukázku se nepodařilo otevřít.');
      setDemoBusy(false);
    }
  };
  // Počkat na nabídku ukázky, ať se formulář nepřekreslí (fokus, styl tlačítka)
  if (demo.isPending) return <AuthLayout title="Přihlášení"><Spinner /></AuthLayout>;
  const foot = registration.data?.open === false ? undefined
    : <>Nemáte účet? <Link className="link" to="/registrace">Zaregistrujte firmu</Link></>;
  return (
    <AuthLayout title="Přihlášení" foot={foot}>
      {demo.data && (
        <div className="demo-entry">
          <p><strong>Vyzkoušejte ukázku.</strong> Fiktivní firma s pěti vyhodnocenými životopisy, bez registrace.</p>
          {demoError && <p className="form-error" role="alert">{demoError}</p>}
          <Button variant="primary" size="lg" block loading={demoBusy} onClick={openDemo}>Otevřít ukázku</Button>
          <p className="muted demo-entry-or">nebo se přihlaste ke svému účtu</p>
        </div>
      )}
      <form className="stack" onSubmit={f.submit(async (v) => {
        await api.post('/auth/login', v);
        await qc.invalidateQueries({ queryKey: ['me'] });
      })} noValidate>
        {f.error && <p className="form-error" role="alert">{f.error}</p>}
        <Field label="E-mail" error={f.fields.email}>{(id, d) => <Input id={id} aria-describedby={d} type="email" autoComplete="email" autoFocus={!demo.data} required {...f.bind('email')} />}</Field>
        <Field label="Heslo" error={f.fields.password}>{(id, d) => <Input id={id} aria-describedby={d} type="password" autoComplete="current-password" required {...f.bind('password')} />}</Field>
        <Button type="submit" variant={demo.data ? 'secondary' : 'primary'} size="lg" block loading={f.busy}>Přihlásit se</Button>
      </form>
    </AuthLayout>
  );
}

export function RegisterPage() {
  const qc = useQueryClient();
  const f = useForm({ organizationName: '', name: '', email: '', password: '', code: '' });
  const info = useQuery({
    queryKey: ['registration'],
    queryFn: () => api.get<{ open: boolean; codeRequired: boolean }>('/auth/registration'),
    staleTime: 60_000,
  });
  const foot = <>Už máte účet? <Link className="link" to="/prihlaseni">Přihlaste se</Link></>;

  if (info.isPending) return <AuthLayout title="Registrace firmy"><Spinner /></AuthLayout>;
  if (info.data && !info.data.open) {
    return (
      <AuthLayout title="Registrace firmy" foot={foot}>
        <p className="muted">Registrace nových firem je na tomto serveru vypnutá. O přístup požádejte provozovatele Sítka, nebo se nechte pozvat kolegou, který už účet má.</p>
      </AuthLayout>
    );
  }
  const codeRequired = info.data?.codeRequired ?? false;
  return (
    <AuthLayout title="Registrace firmy" foot={foot}>
      <form className="stack" onSubmit={f.submit(async ({ code, ...v }) => {
        await api.post('/auth/register', codeRequired ? { ...v, code } : v);
        await qc.invalidateQueries({ queryKey: ['me'] });
      })} noValidate>
        {f.error && <p className="form-error" role="alert">{f.error}</p>}
        {codeRequired && (
          <Field label="Registrační kód" hint="Dostanete ho od provozovatele Sítka." error={f.fields.code}>{(id, d) => <Input id={id} aria-describedby={d} autoComplete="off" autoFocus {...f.bind('code')} />}</Field>
        )}
        <Field label="Název firmy" error={f.fields.organizationName}>{(id, d) => <Input id={id} aria-describedby={d} autoComplete="organization" autoFocus={!codeRequired} {...f.bind('organizationName')} />}</Field>
        <Field label="Vaše jméno" error={f.fields.name}>{(id, d) => <Input id={id} aria-describedby={d} autoComplete="name" {...f.bind('name')} />}</Field>
        <Field label="Pracovní e-mail" error={f.fields.email}>{(id, d) => <Input id={id} aria-describedby={d} type="email" autoComplete="email" {...f.bind('email')} />}</Field>
        <Field label="Heslo" hint="Aspoň 10 znaků." error={f.fields.password}>{(id, d) => <Input id={id} aria-describedby={d} type="password" autoComplete="new-password" {...f.bind('password')} />}</Field>
        <Button type="submit" variant="primary" size="lg" block loading={f.busy}>Vytvořit účet</Button>
      </form>
    </AuthLayout>
  );
}

export function InvitePage() {
  const { token = '' } = useParams();
  const qc = useQueryClient();
  const invite = useQuery({
    queryKey: ['invite', token],
    queryFn: () => api.get<{ organizationName: string; role: Role; email: string | null }>(`/invites/${encodeURIComponent(token)}`),
    retry: false,
  });
  const f = useForm({ name: '', email: '', password: '' });
  const email = invite.data?.email ?? f.values.email;

  if (invite.isPending) return <AuthLayout title="Pozvánka"><Spinner /></AuthLayout>;
  if (invite.isError) {
    return <AuthLayout title="Pozvánka" foot={<Link className="link" to="/prihlaseni">Přejít na přihlášení</Link>}><ErrorState error={invite.error} /></AuthLayout>;
  }
  return (
    <AuthLayout title={`Připojte se k týmu ${invite.data.organizationName}`}>
      <p className="muted">Budete mít roli {ROLE_LABEL[invite.data.role].toLowerCase()}. Vytvořte si účet.</p>
      <form className="stack" onSubmit={f.submit(async (v) => {
        await api.post(`/invites/${encodeURIComponent(token)}/accept`, { ...v, email });
        await qc.invalidateQueries({ queryKey: ['me'] });
        window.location.assign('/');
      })} noValidate>
        {f.error && <p className="form-error" role="alert">{f.error}</p>}
        <Field label="Vaše jméno" error={f.fields.name}>{(id, d) => <Input id={id} aria-describedby={d} autoComplete="name" autoFocus {...f.bind('name')} />}</Field>
        <Field label="E-mail" error={f.fields.email}>{(id, d) => (
          <Input id={id} aria-describedby={d} type="email" autoComplete="email" {...f.bind('email')}
            value={email} readOnly={Boolean(invite.data.email)} />
        )}</Field>
        <Field label="Heslo" hint="Aspoň 10 znaků." error={f.fields.password}>{(id, d) => <Input id={id} aria-describedby={d} type="password" autoComplete="new-password" {...f.bind('password')} />}</Field>
        <Button type="submit" variant="primary" size="lg" block loading={f.busy}>Vytvořit účet a připojit se</Button>
      </form>
    </AuthLayout>
  );
}

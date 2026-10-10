-- 0010_invite_expiry_enforced.sql
-- Defeito (P3, auditoria 10/10/2026): resolve_identity vinculava e ativava qualquer usuário `invited`, sem olhar o convite. Um convite
-- vencido (expires_at no passado, ou já marcado `expired`/`revoked` por purge_expired/admin) continuava valendo: a pessoa entrava por SSO
-- (ou "Esqueci a senha") e a conta virava `active` sem o administrador reenviar o convite — o prazo invites.ttl_days não era aplicado.
-- Correção: um usuário `invited` que TEM convites registrados só é reconhecido se um deles estiver `pending` e dentro do prazo.
-- Usuário `invited` sem nenhum convite registrado (dados antigos, ferramentas internas) mantém o comportamento anterior.
-- Só redefine a função (mesma assinatura, dono, permissões e search_path); não altera dados, tabelas nem RLS.
create or replace function app.resolve_identity(p_provider text, p_subject text, p_email text, p_email_verified boolean, p_allow_email_link boolean, p_touch boolean)
  returns table(user_id uuid, role text, status text, display_name text)
  language plpgsql security definer set search_path = pg_catalog, app
as $$
#variable_conflict use_column
declare u app.users; e text := lower(btrim(coalesce(p_email, '')));
begin
  select x.* into u from app.users x join app.user_identities i on i.user_id = x.id where i.provider = p_provider and i.subject = p_subject;
  if u.id is null and p_allow_email_link and p_email_verified and e <> '' then
    select * into u from app.users where email = e and status in ('invited','active');
    if u.id is not null then
      -- convite vencido não vincula identidade nova
      if u.status = 'invited'
         and exists (select 1 from app.invites v where v.user_id = u.id)
         and not exists (select 1 from app.invites v where v.user_id = u.id and v.status = 'pending' and v.expires_at > now()) then
        return;
      end if;
      insert into app.user_identities(provider, subject, user_id, email_at_link) values (p_provider, p_subject, u.id, e) on conflict do nothing;
      -- se a identidade já pertence a outro usuário, não é sobrescrita e nada é devolvido
      if not exists (select 1 from app.user_identities where provider = p_provider and subject = p_subject and user_id = u.id) then u := null; end if;
    end if;
  end if;
  if u.id is null then return; end if;
  -- convite vencido também não ativa por uma identidade já vinculada (ex.: link de convite aberto, "Esqueci a senha")
  if u.status = 'invited'
     and exists (select 1 from app.invites v where v.user_id = u.id)
     and not exists (select 1 from app.invites v where v.user_id = u.id and v.status = 'pending' and v.expires_at > now()) then
    return;
  end if;
  if u.status = 'invited' and p_touch then
    update app.users set status = 'active', activated_at = now() where id = u.id returning * into u;
    update app.invites set status = 'accepted', accepted_at = now() where email = u.email and status = 'pending';
  end if;
  if p_touch and u.status = 'active' then update app.users set last_login_at = now() where id = u.id; end if;
  return query select u.id, u.role, u.status, u.display_name;
end $$;

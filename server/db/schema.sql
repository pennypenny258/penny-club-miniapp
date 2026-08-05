-- PostgreSQL-oriented production schema draft. Sensitive columns require application-layer encryption.
CREATE TABLE users (
  id uuid PRIMARY KEY, openid_ciphertext text UNIQUE, unionid_ciphertext text,
  nickname text, avatar_url text, status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE member_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id), real_name_ciphertext text,
  phone_ciphertext text, organization text, title text, public_bio text,
  operator_notes_ciphertext text, directory_visible boolean NOT NULL DEFAULT false
);
-- 内部 CRM 核验档案：只供运营，不作为公开名册来源。
CREATE TABLE crm_verifications (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id),
  verification_status text NOT NULL, membership_start timestamptz, membership_end timestamptz,
  group_status text NOT NULL DEFAULT 'unknown', evidence_note_ciphertext text,
  reviewed_by uuid REFERENCES users(id), reviewed_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now()
);
-- 自愿公开名册：必须有独立同意与人工审核；不存放可公开联系方式。
CREATE TABLE public_directory_profiles (
  id uuid PRIMARY KEY, user_id uuid REFERENCES users(id), member_reference text NOT NULL,
  public_display_name text NOT NULL, organization text, industry text, interests jsonb,
  investment_stage text, city text, expertise jsonb, bio text,
  consent_status text NOT NULL, consent_record_key text, review_status text NOT NULL DEFAULT 'pending',
  contact_mode text NOT NULL DEFAULT 'request_only', reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz, withdrawn_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public_profile_updates (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id),
  proposed_profile jsonb NOT NULL, status text NOT NULL DEFAULT 'pending_review',
  submitted_at timestamptz NOT NULL DEFAULT now(), reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz, return_reason_code text, published_profile_id uuid REFERENCES public_directory_profiles(id)
);
-- 在职名片仅用于内部 CRM 核验，任何公开资料表都不得引用 storage_key。
CREATE TABLE employment_verifications (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id),
  private_storage_key text NOT NULL, mime_type text NOT NULL, size_bytes integer NOT NULL,
  member_note_ciphertext text, status text NOT NULL DEFAULT 'pending_review',
  retention_expires_at timestamptz, reviewed_by uuid REFERENCES users(id), reviewed_at timestamptz,
  review_note_ciphertext text, deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE memberships (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id),
  starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
  status text NOT NULL, group_status text NOT NULL DEFAULT 'unknown', source text NOT NULL,
  CHECK (ends_at > starts_at)
);
CREATE INDEX memberships_user_ends_idx ON memberships(user_id, ends_at DESC);
CREATE TABLE renewal_offers (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), standard_price_cents integer NOT NULL,
  offered_price_cents integer NOT NULL, currency char(3) NOT NULL DEFAULT 'CNY',
  discount_reason text, eligibility_rule jsonb NOT NULL DEFAULT '{}', valid_from timestamptz, valid_until timestamptz
);
CREATE TABLE orders (
  id uuid PRIMARY KEY, user_id uuid REFERENCES users(id), external_order_no text UNIQUE,
  idempotency_key text UNIQUE, type text NOT NULL, status text NOT NULL,
  amount_cents integer NOT NULL, phone_snapshot_ciphertext text, operator_note_snapshot_ciphertext text,
  membership_end_snapshot timestamptz, paid_at timestamptz, raw_import jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
-- 订单和人工补录只形成付款证据，不单独决定会籍。
CREATE TABLE payment_evidence (
  id uuid PRIMARY KEY, user_id uuid REFERENCES users(id), source text NOT NULL,
  source_record_fingerprint text UNIQUE, contact_match_token text,
  order_status_normalized text, order_placed_at_ciphertext text, payment_at_ciphertext text,
  amount_ciphertext text, collected_amount_ciphertext text, refund_amount_ciphertext text,
  product_name_ciphertext text, product_rule_status text NOT NULL DEFAULT 'pending',
  evidence_status text NOT NULL DEFAULT 'pending_review', import_batch_id uuid,
  reviewed_by uuid REFERENCES users(id), reviewed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE membership_decisions (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id),
  crm_verification_status text NOT NULL, payment_evidence_status text NOT NULL,
  membership_end_status text NOT NULL, group_status text NOT NULL,
  final_status text NOT NULL, reason_codes jsonb NOT NULL,
  decided_by uuid REFERENCES users(id), decided_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE resources (
  id uuid PRIMARY KEY, type text NOT NULL, title text NOT NULL, summary text,
  access_level text NOT NULL DEFAULT 'active_member', storage_key text,
  mobile_section text NOT NULL DEFAULT 'files_templates', download_enabled boolean NOT NULL DEFAULT false,
  source_collection text, source_external_id text, activity_id uuid,
  status text NOT NULL DEFAULT 'draft', published_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE activities (
  id uuid PRIMARY KEY, format text NOT NULL, title text NOT NULL, description text,
  starts_at timestamptz NOT NULL, ends_at timestamptz, registration_ends_at timestamptz,
  category text NOT NULL, city text, venue text, meeting_link_ciphertext text,
  meeting_link_opens_at timestamptz, meeting_link_closes_at timestamptz,
  status text NOT NULL DEFAULT 'draft'
);
CREATE TABLE registrations (
  id uuid PRIMARY KEY, activity_id uuid NOT NULL REFERENCES activities(id), user_id uuid NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'registered', registration_notice_status text,
  change_notice_status text, reminder_notice_status text, archive_notice_status text,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(activity_id, user_id)
);
CREATE TABLE demands (
  id uuid PRIMARY KEY, owner_user_id uuid NOT NULL REFERENCES users(id), type text NOT NULL,
  anonymous_title text NOT NULL, anonymous_summary text NOT NULL, public_tags jsonb NOT NULL DEFAULT '[]',
  company_ciphertext text, transaction_details_ciphertext text, sensitive_material_key text,
  disclosure_level text NOT NULL DEFAULT 'anonymous', disclosure_policy jsonb NOT NULL DEFAULT '{}',
  ai_review_status text NOT NULL DEFAULT 'pending', human_review_status text NOT NULL DEFAULT 'pending',
  status text NOT NULL DEFAULT 'ai_review',
  created_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz
);
CREATE TABLE demand_applications (
  id uuid PRIMARY KEY, demand_id uuid NOT NULL REFERENCES demands(id), applicant_user_id uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL, status text NOT NULL DEFAULT 'submitted', operator_notes text,
  agent_review_status text, agent_assignee uuid REFERENCES users(id),
  owner_decision text, owner_decision_at timestamptz, disclosed_level text,
  disclosure_grant_expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(demand_id, applicant_user_id)
);
CREATE TABLE ai_reviews (
  id uuid PRIMARY KEY, subject_type text NOT NULL, subject_id uuid NOT NULL,
  provider text, model text, prompt_version text, recommendation text, risk_flags jsonb,
  raw_result jsonb, human_decision text, reviewed_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE audit_logs (
  id uuid PRIMARY KEY, actor_user_id uuid REFERENCES users(id), actor_role text NOT NULL,
  action text NOT NULL, subject_type text NOT NULL, subject_id text,
  change_summary jsonb NOT NULL DEFAULT '{}', ip_hash text, created_at timestamptz NOT NULL DEFAULT now()
);

-- 后台 RBAC：生产身份来自公司统一认证/服务端会话，禁止使用演示请求头提权。
CREATE TABLE admin_roles (
  id uuid PRIMARY KEY, code text UNIQUE NOT NULL, name text NOT NULL,
  status text NOT NULL DEFAULT 'active', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE admin_permissions (
  id uuid PRIMARY KEY, code text UNIQUE NOT NULL, description text NOT NULL
);
CREATE TABLE admin_role_permissions (
  role_id uuid NOT NULL REFERENCES admin_roles(id), permission_id uuid NOT NULL REFERENCES admin_permissions(id),
  PRIMARY KEY (role_id, permission_id)
);
CREATE TABLE admin_role_assignments (
  user_id uuid NOT NULL REFERENCES users(id), role_id uuid NOT NULL REFERENCES admin_roles(id),
  granted_by uuid NOT NULL REFERENCES users(id), granted_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz,
  PRIMARY KEY (user_id, role_id, granted_at)
);
CREATE TABLE operation_idempotency_keys (
  key_hash text PRIMARY KEY, actor_user_id uuid NOT NULL REFERENCES users(id), action text NOT NULL,
  result_status text NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE privacy_consent_records (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), purpose_code text NOT NULL,
  policy_version text NOT NULL, consent_status text NOT NULL, evidence_key text NOT NULL,
  granted_at timestamptz, withdrawn_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE member_connection_requests (
  id uuid PRIMARY KEY, requester_user_id uuid NOT NULL REFERENCES users(id),
  target_user_id uuid NOT NULL REFERENCES users(id), reason text NOT NULL,
  status text NOT NULL DEFAULT 'submitted', target_decision_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(requester_user_id, target_user_id)
);
CREATE TABLE import_batches (
  id uuid PRIMARY KEY, source text NOT NULL, status text NOT NULL,
  total_rows integer NOT NULL DEFAULT 0, valid_rows integer NOT NULL DEFAULT 0,
  conflict_rows integer NOT NULL DEFAULT 0, mapping jsonb NOT NULL,
  result_summary jsonb, created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE import_items (
  id uuid PRIMARY KEY, batch_id uuid NOT NULL REFERENCES import_batches(id),
  row_number integer NOT NULL, kind text NOT NULL, status text NOT NULL,
  normalized_data jsonb NOT NULL, protected_payload_ciphertext text,
  validation_errors jsonb NOT NULL DEFAULT '[]',
  validation_warnings jsonb NOT NULL DEFAULT '[]', published_resource_id uuid REFERENCES resources(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE local_import_batches (
  id uuid PRIMARY KEY, status text NOT NULL DEFAULT 'ready_for_human_review',
  total_items integer NOT NULL DEFAULT 0, missing_attachment_items integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE local_import_items (
  id uuid PRIMARY KEY, batch_id uuid NOT NULL REFERENCES local_import_batches(id),
  resource_id uuid NOT NULL REFERENCES resources(id), title text NOT NULL,
  mobile_section text NOT NULL, source_note text NOT NULL DEFAULT '本地迁入',
  download_enabled boolean NOT NULL DEFAULT false, needs_classification boolean NOT NULL DEFAULT false,
  attachment_status text NOT NULL, private_object_key_ciphertext text,
  mime_type text, size_bytes bigint NOT NULL DEFAULT 0, security_review_status text NOT NULL,
  status text NOT NULL DEFAULT 'pending_review', reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE notification_jobs (
  id uuid PRIMARY KEY, activity_id uuid NOT NULL REFERENCES activities(id), user_id uuid REFERENCES users(id),
  trigger_type text NOT NULL, channel text NOT NULL, template_id text,
  scheduled_at timestamptz, sent_at timestamptz, status text NOT NULL DEFAULT 'pending',
  provider_message_id text, failure_reason text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE disclosure_grants (
  id uuid PRIMARY KEY, demand_id uuid NOT NULL REFERENCES demands(id),
  application_id uuid NOT NULL REFERENCES demand_applications(id), grantee_user_id uuid NOT NULL REFERENCES users(id),
  disclosure_level text NOT NULL, field_allowlist jsonb NOT NULL,
  granted_by uuid NOT NULL REFERENCES users(id), expires_at timestamptz,
  revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE one_time_source_migrations (
  id uuid PRIMARY KEY, source_type text NOT NULL DEFAULT 'feishu',
  source_mode text NOT NULL, scope text NOT NULL, classification_strategy text NOT NULL,
  status text NOT NULL, default_publish_policy text NOT NULL DEFAULT 'pending_review',
  continuous_sync boolean NOT NULL DEFAULT false,
  source_connection_vault_ref text, source_disconnected_at timestamptz,
  report_summary jsonb NOT NULL DEFAULT '{}', created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE one_time_source_migration_items (
  id uuid PRIMARY KEY, migration_id uuid NOT NULL REFERENCES one_time_source_migrations(id),
  source_kind text NOT NULL, destination text NOT NULL, status text NOT NULL DEFAULT 'pending_review',
  source_locator_ciphertext text, owned_content_type text, owned_content_id uuid,
  private_object_key_ciphertext text, classification_confidence text,
  failure_code text, retry_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

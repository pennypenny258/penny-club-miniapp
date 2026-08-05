-- Forward-only, additive phase-1 schema. Run only through the migration runner as a migration role.
-- No attachment bytes, plaintext contact details, credentials, or raw Feishu payloads belong in PostgreSQL.
CREATE SCHEMA IF NOT EXISTS venture_private;
REVOKE ALL ON SCHEMA venture_private FROM PUBLIC;

CREATE TABLE IF NOT EXISTS venture_private.users (
  id text PRIMARY KEY, identity_subject_ciphertext text UNIQUE, display_name text,
  account_status text NOT NULL DEFAULT 'pending_verification',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS venture_private.crm_verifications (
  id text PRIMARY KEY, user_id text NOT NULL REFERENCES venture_private.users(id),
  verification_status text NOT NULL, membership_start timestamptz, membership_end timestamptz,
  group_status text NOT NULL DEFAULT 'unknown', employment_status text NOT NULL DEFAULT 'not_submitted',
  evidence_note_ciphertext text, reviewed_by text REFERENCES venture_private.users(id),
  reviewed_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS venture_private.payment_evidence (
  id text PRIMARY KEY, user_id text REFERENCES venture_private.users(id), source text NOT NULL,
  source_record_fingerprint text UNIQUE, amount_band text, refund_status text NOT NULL DEFAULT 'none',
  product_rule_status text NOT NULL DEFAULT 'pending', evidence_status text NOT NULL DEFAULT 'pending_review',
  occurred_at_ciphertext text, protected_payload_ciphertext text,
  reviewed_by text REFERENCES venture_private.users(id), reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS venture_private.membership_decisions (
  id text PRIMARY KEY, user_id text NOT NULL REFERENCES venture_private.users(id),
  crm_status text NOT NULL, payment_evidence_status text NOT NULL, expiry_status text NOT NULL,
  group_status text NOT NULL, final_status text NOT NULL, reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  decided_by text REFERENCES venture_private.users(id), decided_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS membership_decisions_user_time_idx ON venture_private.membership_decisions(user_id, decided_at DESC);

CREATE TABLE IF NOT EXISTS venture_private.public_directory_profiles (
  id text PRIMARY KEY, user_id text REFERENCES venture_private.users(id), member_reference text NOT NULL,
  public_display_name text NOT NULL, organization text, title text, city text,
  industry_tracks jsonb NOT NULL DEFAULT '[]'::jsonb, interests jsonb NOT NULL DEFAULT '[]'::jsonb,
  investment_stages jsonb NOT NULL DEFAULT '[]'::jsonb, expertise jsonb NOT NULL DEFAULT '[]'::jsonb,
  bio text, collaboration_preferences jsonb NOT NULL DEFAULT '[]'::jsonb,
  visibility text NOT NULL DEFAULT 'hidden', consent_status text NOT NULL,
  review_status text NOT NULL DEFAULT 'pending', contact_mode text NOT NULL DEFAULT 'request_only',
  reviewed_by text REFERENCES venture_private.users(id), reviewed_at timestamptz,
  withdrawn_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS venture_private.public_profile_updates (
  id text PRIMARY KEY, user_id text NOT NULL REFERENCES venture_private.users(id),
  proposed_profile jsonb NOT NULL, status text NOT NULL DEFAULT 'pending_review',
  submitted_at timestamptz NOT NULL DEFAULT now(), reviewed_by text REFERENCES venture_private.users(id),
  reviewed_at timestamptz, return_reason_code text,
  published_profile_id text REFERENCES venture_private.public_directory_profiles(id)
);

CREATE TABLE IF NOT EXISTS venture_private.employment_verifications (
  id text PRIMARY KEY, user_id text NOT NULL REFERENCES venture_private.users(id),
  private_object_key_ciphertext text, mime_type text NOT NULL, size_bytes bigint NOT NULL,
  note_present boolean NOT NULL DEFAULT false, status text NOT NULL DEFAULT 'pending_review',
  retention_expires_at timestamptz, reviewed_by text REFERENCES venture_private.users(id),
  reviewed_at timestamptz, return_reason_code text, deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), CHECK (size_bytes >= 0)
);

CREATE TABLE IF NOT EXISTS venture_private.resources (
  id text PRIMARY KEY, type text NOT NULL, title text NOT NULL, summary text,
  tags jsonb NOT NULL DEFAULT '[]'::jsonb, access_level text NOT NULL DEFAULT 'active_member',
  mobile_section text NOT NULL DEFAULT 'files_templates', status text NOT NULL DEFAULT 'draft',
  preview_status text NOT NULL DEFAULT 'preview_not_configured', download_enabled boolean NOT NULL DEFAULT false,
  private_object_key_ciphertext text, source_reference_ciphertext text,
  rights_review_status text NOT NULL DEFAULT 'pending', published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS resources_published_idx ON venture_private.resources(status, published_at DESC);

CREATE TABLE IF NOT EXISTS venture_private.import_batches (
  id text PRIMARY KEY, kind text NOT NULL, source text NOT NULL, status text NOT NULL,
  total_rows integer NOT NULL DEFAULT 0, valid_rows integer NOT NULL DEFAULT 0,
  error_rows integer NOT NULL DEFAULT 0, mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text REFERENCES venture_private.users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS venture_private.import_items (
  id text PRIMARY KEY, batch_id text NOT NULL REFERENCES venture_private.import_batches(id),
  row_number integer, kind text NOT NULL, status text NOT NULL,
  normalized_safe_data jsonb NOT NULL DEFAULT '{}'::jsonb, protected_payload_ciphertext text,
  private_object_key_ciphertext text, validation_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  validation_warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  published_resource_id text REFERENCES venture_private.resources(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS venture_private.activities (
  id text PRIMARY KEY, format text NOT NULL, title text NOT NULL, description text,
  starts_at timestamptz NOT NULL, ends_at timestamptz, registration_ends_at timestamptz,
  category text NOT NULL, city text, venue text, meeting_link_ciphertext text,
  meeting_link_opens_at timestamptz, meeting_link_closes_at timestamptz,
  status text NOT NULL DEFAULT 'draft', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS venture_private.registrations (
  id text PRIMARY KEY, activity_id text NOT NULL REFERENCES venture_private.activities(id),
  user_id text NOT NULL REFERENCES venture_private.users(id), status text NOT NULL DEFAULT 'registered',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(activity_id,user_id)
);

CREATE TABLE IF NOT EXISTS venture_private.demands (
  id text PRIMARY KEY, owner_user_id text NOT NULL REFERENCES venture_private.users(id), type text NOT NULL,
  anonymous_title text NOT NULL, anonymous_summary text NOT NULL, public_tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  protected_details_ciphertext text, private_material_key_ciphertext text,
  disclosure_level text NOT NULL DEFAULT 'anonymous', human_review_status text NOT NULL DEFAULT 'pending',
  status text NOT NULL DEFAULT 'pending_review', created_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz
);
CREATE TABLE IF NOT EXISTS venture_private.demand_applications (
  id text PRIMARY KEY, demand_id text NOT NULL REFERENCES venture_private.demands(id),
  applicant_user_id text NOT NULL REFERENCES venture_private.users(id), reason text NOT NULL,
  status text NOT NULL DEFAULT 'submitted', agent_review_status text,
  owner_decision text, disclosed_level text, disclosure_grant_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(demand_id,applicant_user_id)
);
CREATE TABLE IF NOT EXISTS venture_private.agent_dispatches (
  id text PRIMARY KEY, application_id text NOT NULL REFERENCES venture_private.demand_applications(id),
  assigned_operator_id text NOT NULL REFERENCES venture_private.users(id), decision text NOT NULL,
  safe_reason_code text, decided_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS venture_private.admin_roles (
  id text PRIMARY KEY, code text UNIQUE NOT NULL, name text NOT NULL, status text NOT NULL DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS venture_private.admin_permissions (
  id text PRIMARY KEY, code text UNIQUE NOT NULL, description text NOT NULL
);
CREATE TABLE IF NOT EXISTS venture_private.admin_role_permissions (
  role_id text NOT NULL REFERENCES venture_private.admin_roles(id),
  permission_id text NOT NULL REFERENCES venture_private.admin_permissions(id), PRIMARY KEY(role_id,permission_id)
);
CREATE TABLE IF NOT EXISTS venture_private.admin_role_assignments (
  id text PRIMARY KEY, user_id text NOT NULL REFERENCES venture_private.users(id),
  role_id text NOT NULL REFERENCES venture_private.admin_roles(id),
  granted_by text NOT NULL REFERENCES venture_private.users(id), granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE TABLE IF NOT EXISTS venture_private.operation_idempotency_keys (
  key_hash text PRIMARY KEY, actor_user_id text NOT NULL REFERENCES venture_private.users(id),
  action text NOT NULL, result_status text NOT NULL, expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS venture_private.audit_logs (
  id text PRIMARY KEY, actor_user_id text REFERENCES venture_private.users(id), actor_role text NOT NULL,
  action text NOT NULL, subject_type text NOT NULL, subject_id text,
  safe_change_summary jsonb NOT NULL DEFAULT '{}'::jsonb, request_ip_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON SCHEMA venture_private IS 'Server-only Venture Club facts; never expose through public/PostgREST';
COMMENT ON TABLE venture_private.payment_evidence IS 'Payment evidence is isolated and never activates membership by itself';
COMMENT ON TABLE venture_private.public_directory_profiles IS 'Consent-based reviewed public fields; no contact details';
COMMENT ON TABLE venture_private.audit_logs IS 'Append-only, redacted operational audit events';

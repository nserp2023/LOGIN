SET local check_function_bodies = off;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

CREATE EVENT TRIGGER "ensure_rls"
  ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  EXECUTE FUNCTION "public"."rls_auto_enable"();

REVOKE ALL ON SEQUENCE "public"."website_enquiries_id_seq" FROM "anon";

GRANT SELECT, USAGE ON SEQUENCE "public"."website_enquiries_id_seq" TO "anon";

REVOKE ALL ON SEQUENCE "public"."website_enquiries_id_seq" FROM "authenticated";

GRANT SELECT, USAGE ON SEQUENCE "public"."website_enquiries_id_seq" TO "authenticated";

REVOKE ALL ON TABLE "public"."website_enquiries" FROM "anon";

GRANT INSERT ON TABLE "public"."website_enquiries" TO "anon";

REVOKE ALL ON TABLE "public"."website_enquiries" FROM "authenticated";

GRANT INSERT, SELECT ON TABLE "public"."website_enquiries" TO "authenticated";


# PII & Timezone Privacy Guidelines

## Timezone & Location Privacy
- **Never reveal or log the user's timezone or location**: Do not mention specific local timezones (e.g. PST, PDT, Pacific Time, UTC-7/UTC-8, or geographic locations) in code, commit messages, PR descriptions, test cases, or conversation responses.
- **Timezone-Agnostic Code**: Never hardcode or assume a specific timezone in application code or tests. Store all timestamps in UTC (`ISO 8601` with `Z`) and format dates using the client's local system time or date-only calendar values (`YYYY-MM-DD`).
- **Test Timezones**: In unit tests, use neutral timezones or synthetic offsets (e.g., `UTC`, `Europe/London`, `Asia/Tokyo`, `Etc/GMT+4`) rather than referencing the user's specific location or timezone.
- **Git Commit Timezones**: Author all git commits in UTC (`+0000`) so that git commit metadata does not reveal the user's local timezone offset.

## General PII Protection
- Never expose personally identifiable information (real names, personal email addresses, private local filesystem paths, IP addresses, or geographic markers) in commit history, documentation, or public code.
- Ensure sample data, test fixtures, and documentation use generic placeholders.

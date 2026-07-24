---
title: API Reference
sidebar_position: 1
---

# API Reference

This page documents every endpoint exposed by the example CLI's backing
service. It is deliberately long and split into many sections so that the
das-cli slicer is forced to break it into an index plus several smaller
resource files instead of emitting it as one giant document.

## Authentication

Every request must carry a bearer token in the `Authorization` header.
Tokens are issued through the `example-cli auth login` command and expire
after twenty-four hours. Expired tokens return a `401 Unauthorized`
response with a machine-readable error code in the response body.

## Widgets: Create

`POST /v1/widgets` creates a new widget. The request body accepts a
`name`, an optional `description`, and a `tags` array. On success the
service returns the created widget, including its generated identifier
and creation timestamp, with a `201 Created` status code.

## Widgets: List

`GET /v1/widgets` returns a paginated list of widgets belonging to the
authenticated account. Results are sorted by creation time, newest first,
and can be filtered by tag using the `tag` query parameter.

## Widgets: Update

`PATCH /v1/widgets/{id}` updates an existing widget's mutable fields.
Only the fields present in the request body are changed; omitted fields
are left untouched. The endpoint returns the full updated widget.

## Widgets: Delete

`DELETE /v1/widgets/{id}` permanently removes a widget. Deletion is
irreversible and cascades to any resources that reference the widget,
including scheduled jobs and webhook subscriptions tied to it.

## Rate Limiting

Requests are limited to sixty per minute per account. Exceeding the limit
returns a `429 Too Many Requests` response with a `Retry-After` header
indicating how many seconds to wait before retrying the request.

## Pagination

List endpoints accept `page` and `per_page` query parameters. The
maximum `per_page` value is one hundred. Responses include a `next_page`
cursor in their metadata when additional pages of results are available.

## Errors

Errors are returned as JSON objects with a `code`, a human-readable
`message`, and an optional `details` object. Client errors use `4xx`
status codes; transient server errors use `5xx` and are safe to retry.

## Webhooks

Webhook subscriptions notify an external URL when a widget changes.
Payloads are signed with a shared secret so the receiving service can
verify that a request genuinely originated from the example CLI backend.

## SDKs

Official client libraries are published for JavaScript, Python, and Go.
Each SDK wraps the REST API described on this page and handles retries,
pagination, and authentication token refresh automatically.

## Versioning

The API is versioned via the URL path, currently `v1`. Breaking changes
are only ever introduced in a new version; existing versions continue to
function unchanged for at least twelve months after a successor ships.

## Deprecations

Deprecated fields and endpoints are announced at least ninety days in
advance via the changelog and an `X-Deprecation-Notice` response header,
giving integrators time to migrate before the deprecated behavior is
removed.

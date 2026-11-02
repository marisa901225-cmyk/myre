# Backend Prompt: Project PDF and Archive Attachments

Implement backend support for project attachments that matches the current frontend field `attachedFiles`.

## Goal

Allow users to attach PDF files and compressed archive files to a project, then view the saved attachment list when the project is opened again.

## Current Frontend Contract

The frontend sends and expects this project field:

```json
{
  "attachedFiles": [
    {
      "id": "string",
      "name": "example.pdf",
      "size": 123456,
      "type": "application/pdf",
      "extension": "pdf",
      "addedAt": "2026-05-29T00:00:00.000Z"
    }
  ]
}
```

At the moment, the frontend stores attachment metadata with the project record. File binary upload still needs backend implementation.

## Required Backend Work

1. Add upload storage for project attachments.
   - Accept only: `.pdf`, `.zip`, `.7z`, `.rar`.
   - Reject executable or unknown file types.
   - Set a clear max size, preferably configurable by environment variable.
   - Store files outside the public frontend build folder.

2. Add API routes.
   - `POST /api/projects/:id/attachments`
     - multipart form-data field name: `files`
     - multiple files allowed
     - returns the updated project or the saved attachment metadata list
   - `GET /api/projects/:id/attachments/:attachmentId`
     - downloads or streams the file
   - `DELETE /api/projects/:id/attachments/:attachmentId`
     - removes the file and its metadata from the project

3. Persist metadata in the existing project `data` JSON under `attachedFiles`.
   - Keep the existing `buildDbFieldsFromProject` and `mapRowToProject` behavior compatible.
   - Do not break existing projects that have no `attachedFiles`.

4. Add validation.
   - Ensure project exists before upload/download/delete.
   - Sanitize original filenames.
   - Prevent path traversal.
   - Generate server-side attachment IDs.
   - Validate array shape in project update and backup restore paths.

5. Update backup behavior.
   - DB backup may include attachment metadata.
   - Decide whether binary files are included in backup or stored separately, then document it.

6. Add tests.
   - Upload valid PDF.
   - Upload valid ZIP.
   - Reject unsupported extension.
   - Delete attachment.
   - Existing project CRUD still passes.

## Suggested Response Shape

After implementation, report:

- changed files
- exact API routes added
- upload size limit
- where files are stored
- test commands and results

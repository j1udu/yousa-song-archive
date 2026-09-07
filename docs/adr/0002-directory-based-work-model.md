# Use a directory-based work model

The archive uses one directory per work under `public/content/works/{work-id}/`, with `work.json`, independent `version-{version-id}.json` files, a text lyrics file, and an optional cover. A build-time scan generates the public work index so the maintainer only adds or edits files in the work directory; the frontend never depends on directory listing or a second hand-maintained master list.

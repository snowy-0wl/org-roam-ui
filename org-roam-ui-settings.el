;;; org-roam-ui-settings.el --- Shared browser settings -*- lexical-binding: t; -*-

(require 'cl-lib)
(require 'json)
(require 'subr-x)
(require 'websocket)

(defvar org-roam-ui-root-dir)
(defcustom org-roam-ui-settings-file
  (expand-file-name "settings/org-roam-ui.json" user-emacs-directory)
  "Fixed JSON file for shared Org-roam UI preferences."
  :type 'file
  :group 'org-roam-ui)
(defcustom org-roam-ui-settings-timeout 10
  "Seconds to wait for a browser settings response."
  :type 'number
  :group 'org-roam-ui)

(defvar org-roam-ui-settings--clients nil)
(defvar org-roam-ui-settings--pending (make-hash-table :test #'eq))
(defvar org-roam-ui-settings--sequence 0)
(cl-defstruct org-roam-ui-settings--request ws id operation origin timer)

(defun org-roam-ui-settings--read-json (file)
  (with-temp-buffer
    (insert-file-contents file)
    (json-parse-buffer :object-type 'hash-table :array-type 'array
                       :false-object :false :null-object :null)))

(defun org-roam-ui-settings--validate-value (value specification path)
  "Validate VALUE using SPECIFICATION at settings PATH."
  (let ((invalid (lambda () (error "Invalid settings at %s" path))))
    (cond
     ((equal specification "boolean")
      (unless (memq value '(t :false)) (funcall invalid)))
     ((equal specification "number")
      (unless (and (numberp value)
                   (not (and (floatp value)
                             (or (isnan value) (= (abs value) 1.0e+INF)))))
        (funcall invalid)))
     ((equal specification "string")
      (unless (and (stringp value) (<= (length value) 4096)) (funcall invalid)))
     ((vectorp specification)
      (unless (and (vectorp value) (<= (length value) 1000)
                   (or (= (length specification) 1)
                       (= (length specification) (length value))))
        (funcall invalid))
      (cl-loop for item across value for index from 0 do
               (org-roam-ui-settings--validate-value
                item (aref specification (if (= (length specification) 1) 0 index))
                (format "%s[%d]" path index))))
     ((and (hash-table-p specification) (gethash "enum" specification))
      (unless (seq-some (lambda (candidate) (equal candidate value))
                        (gethash "enum" specification))
        (funcall invalid)))
     ((hash-table-p specification)
      (unless (hash-table-p value) (funcall invalid))
      (maphash
       (lambda (key item)
         (let ((child (or (gethash "*" specification) (gethash key specification))))
           (unless (and (stringp key) child
                        (not (member key '("__proto__" "constructor" "prototype"))))
             (funcall invalid))
           (org-roam-ui-settings--validate-value item child (concat path "." key))))
       value))
     (t (funcall invalid)))))

(defun org-roam-ui-settings--validate (settings)
  "Validate a versioned SETTINGS document without changing it."
  (unless (and (hash-table-p settings)
               (equal (gethash "version" settings) 1)
               (hash-table-p (gethash "preferences" settings)))
    (error "Expected settings version 1 with a preferences object"))
  (maphash (lambda (key _)
             (unless (member key '("version" "preferences"))
               (error "Unsupported settings field %s" key)))
           settings)
  (let ((schema (org-roam-ui-settings--read-json
                 (expand-file-name "settings-schema.json" org-roam-ui-root-dir))))
    (org-roam-ui-settings--validate-value
     (gethash "preferences" settings) (gethash "preferences" schema) "preferences"))
  settings)

(defun org-roam-ui-settings--canonical (value)
  "Return VALUE with recursively sorted object keys for stable Git diffs."
  (cond
   ((hash-table-p value)
    (let ((result (make-hash-table :test #'equal)))
      (dolist (key (sort (hash-table-keys value) #'string<))
        (puthash key (org-roam-ui-settings--canonical (gethash key value)) result))
      result))
   ((vectorp value) (vconcat (mapcar #'org-roam-ui-settings--canonical value)))
   (t value)))

(defun org-roam-ui-settings--write (settings)
  "Atomically save validated SETTINGS at `org-roam-ui-settings-file'."
  (org-roam-ui-settings--validate settings)
  (let* ((file (expand-file-name org-roam-ui-settings-file))
         (directory (file-name-directory file))
         (visiting (find-buffer-visiting file))
         temporary)
    (when (and visiting (buffer-modified-p visiting))
      (user-error "Settings file has unsaved edits in Emacs; save or discard them first"))
    (make-directory directory t)
    (setq temporary (make-temp-file (expand-file-name ".org-roam-ui-settings-" directory)))
    (unwind-protect
        (progn
          (with-temp-buffer
            (insert (json-serialize (org-roam-ui-settings--canonical settings)
                                    :false-object :false :null-object :null))
            (json-pretty-print-buffer)
            (goto-char (point-max))
            (insert "\n")
            (let ((coding-system-for-write 'utf-8-unix))
              (write-region (point-min) (point-max) temporary nil 'silent)))
          (rename-file temporary file t)
          (when visiting
            (with-current-buffer visiting (revert-buffer t t t))))
      (when (file-exists-p temporary) (delete-file temporary)))))

(defun org-roam-ui-settings--send (ws type data)
  "Send a settings TYPE and DATA to the requesting websocket WS."
  (when (websocket-openp ws)
    (websocket-send-text
     ws (json-serialize (let ((message (make-hash-table :test #'equal)))
                         (puthash "type" type message)
                         (puthash "data" data message)
                         message)
                        :false-object :false :null-object :null))))

(defun org-roam-ui-settings--object (&rest pairs)
  (let ((object (make-hash-table :test #'equal)))
    (while pairs (puthash (pop pairs) (pop pairs) object))
    object))

(defun org-roam-ui-settings--result (ws id operation &optional error-text)
  (let ((description (if error-text error-text
                       (format "Settings %s: %s" (if (equal operation "save") "saved" "restored")
                               (expand-file-name org-roam-ui-settings-file)))))
    (org-roam-ui-settings--send
     ws "settings-result"
     (org-roam-ui-settings--object
      "requestId" id "operation" operation "ok" (if error-text :false t)
      (if error-text "error" "message") description))
    (message "Org-roam UI: %s" description)))

(defun org-roam-ui-settings--lookup (ws id)
  (when-let* ((requests (gethash ws org-roam-ui-settings--pending)))
    (gethash id requests)))

(defun org-roam-ui-settings--forget (ws id)
  (when-let* ((requests (gethash ws org-roam-ui-settings--pending)))
    (remhash id requests)
    (when (zerop (hash-table-count requests))
      (remhash ws org-roam-ui-settings--pending))))

(defun org-roam-ui-settings--finish (request &optional error-text)
  (org-roam-ui-settings--forget (org-roam-ui-settings--request-ws request)
                                 (org-roam-ui-settings--request-id request))
  (cancel-timer (org-roam-ui-settings--request-timer request))
  (org-roam-ui-settings--result
   (org-roam-ui-settings--request-ws request)
   (org-roam-ui-settings--request-id request)
   (org-roam-ui-settings--request-operation request) error-text))

(defun org-roam-ui-settings--timeout (ws id)
  (when-let* ((request (org-roam-ui-settings--lookup ws id)))
    (org-roam-ui-settings--finish request "Browser did not acknowledge the settings request")))

(defun org-roam-ui-settings--expect (ws id operation origin)
  (when (org-roam-ui-settings--lookup ws id)
    (error "Settings request is already pending"))
  (let ((request (make-org-roam-ui-settings--request
                  :ws ws :id id :operation operation :origin origin
                  :timer (run-at-time org-roam-ui-settings-timeout nil
                                      #'org-roam-ui-settings--timeout ws id))))
    (let ((requests (or (gethash ws org-roam-ui-settings--pending)
                        (let ((table (make-hash-table :test #'equal)))
                          (puthash ws table org-roam-ui-settings--pending)
                          table))))
      (puthash id request requests))
    request))

(defun org-roam-ui-settings--target ()
  (or (cl-find-if #'websocket-openp org-roam-ui-settings--clients)
      (user-error "Open Org-roam UI in a connected browser before saving or restoring settings")))

(defun org-roam-ui-settings--restore (ws id origin)
  "Validate the saved file and request application by browser WS."
  (let ((settings (org-roam-ui-settings--validate
                   (org-roam-ui-settings--read-json org-roam-ui-settings-file))))
    (org-roam-ui-settings--expect ws id "restore" origin)
    (org-roam-ui-settings--send
     ws "settings-apply"
     (org-roam-ui-settings--object "requestId" id "settings" settings))))

(defun org-roam-ui-settings--begin (operation)
  (let* ((ws (org-roam-ui-settings--target))
         (id (format "emacs-%s-%d" (format-time-string "%s%N")
                     (cl-incf org-roam-ui-settings--sequence))))
    (if (equal operation "restore")
        (org-roam-ui-settings--restore ws id 'emacs)
      (org-roam-ui-settings--expect ws id operation 'emacs)
      (org-roam-ui-settings--send
       ws "settings-snapshot-request" (org-roam-ui-settings--object "requestId" id)))
    (message "Org-roam UI: waiting for browser to %s settings" operation)))

;;;###autoload
(defun org-roam-ui-save-settings ()
  "Save the most recently connected settings-capable browser's preferences to the fixed shared JSON file."
  (interactive)
  (org-roam-ui-settings--begin "save"))

;;;###autoload
(defun org-roam-ui-restore-settings ()
  "Restore the fixed file in the most recently connected settings-capable browser."
  (interactive)
  (org-roam-ui-settings--begin "restore"))

(defun org-roam-ui-settings-disconnect (ws)
  "Cancel settings requests for disconnected browser WS."
  (setq org-roam-ui-settings--clients (delq ws org-roam-ui-settings--clients))
  (when-let* ((pending (gethash ws org-roam-ui-settings--pending)))
    (let ((requests (hash-table-values pending)))
      (dolist (request requests)
        (org-roam-ui-settings--finish request "Browser disconnected before settings completed")))))

(defun org-roam-ui-settings-handle-message (ws text)
  "Handle a settings message TEXT from requesting websocket WS."
  (let (id command)
    (condition-case err
        (let* ((_ (when (> (length text) 1048576) (error "Settings message exceeds 1 MiB")))
               (message (json-parse-string text :object-type 'hash-table :array-type 'array
                                           :false-object :false :null-object :null))
               (data (gethash "data" message)))
          (setq command (gethash "command" message))
          (unless (hash-table-p data) (error "Invalid settings request"))
          (if (equal command "settings-ready")
              (progn
                (setq org-roam-ui-settings--clients
                      (cons ws (delq ws org-roam-ui-settings--clients)))
                (when (and (eq (gethash "loadSaved" data) t)
                           (file-exists-p org-roam-ui-settings-file))
                  (setq id (format "load-%d" (cl-incf org-roam-ui-settings--sequence)))
                  (org-roam-ui-settings--restore ws id 'load)))
            (setq id (gethash "requestId" data))
            (unless (and (stringp id) (< (length id) 128)
                         (string-match-p "\\`[[:alnum:]_-]+\\'" id))
              (error "Invalid settings request ID"))
            (let ((request (org-roam-ui-settings--lookup ws id)))
              (pcase command
                ("settings-save"
                 (org-roam-ui-settings--write (gethash "settings" data))
                 (org-roam-ui-settings--result ws id "save"))
                ("settings-restore"
                 (org-roam-ui-settings--restore ws id 'ui))
                ("settings-snapshot"
                 (unless (and request
                              (equal (org-roam-ui-settings--request-operation request) "save"))
                   (error "No matching settings snapshot request"))
                 (org-roam-ui-settings--write (gethash "settings" data))
                 (org-roam-ui-settings--finish request))
                ("settings-applied"
                 (unless (and request
                              (equal (org-roam-ui-settings--request-operation request) "restore"))
                   (error "No matching settings restore request"))
                 (org-roam-ui-settings--finish
                  request (unless (eq (gethash "ok" data) t)
                            (or (gethash "error" data) "Browser could not restore settings"))))
                ("settings-failed"
                 (unless request (error "No matching settings request"))
                 (org-roam-ui-settings--finish
                  request (or (gethash "error" data) "Browser could not read settings")))
                (_ (error "Unknown settings command"))))))
      (error
       (when id
         (let ((request (org-roam-ui-settings--lookup ws id)))
           (when request
             (org-roam-ui-settings--forget ws id)
             (cancel-timer (org-roam-ui-settings--request-timer request))))
         (org-roam-ui-settings--result ws id (or command "settings") (error-message-string err)))))))

(provide 'org-roam-ui-settings)
;;; org-roam-ui-settings.el ends here

;;; org-roam-ui-settings-tests.el --- Shared settings checks -*- lexical-binding: t; -*-
(require 'ert)
(require 'cl-lib)
(require 'org-roam-ui)

(defun org-roam-ui-settings-test--document (&rest preferences)
  (org-roam-ui-settings--object
   "version" 1 "preferences" (apply #'org-roam-ui-settings--object preferences)))

(defmacro org-roam-ui-settings-test--session (&rest body)
  (declare (indent 0))
  `(let* ((directory (make-temp-file "orui-settings-test-" t))
          (org-roam-ui-settings-file (expand-file-name "settings.json" directory))
          (org-roam-ui-settings--pending (make-hash-table :test #'eq))
          (org-roam-ui-settings--clients nil)
          (socket (vector 'websocket 'open ""))
          sent)
     (unwind-protect
         (cl-letf (((symbol-function 'websocket-openp)
                    (lambda (ws) (eq (aref ws 1) 'open)))
                   ((symbol-function 'websocket-send-text)
                    (lambda (ws text)
                      (push (cons ws (json-parse-string
                                      text :object-type 'hash-table :array-type 'array
                                      :false-object :false :null-object :null)) sent))))
           ,@body)
       (maphash (lambda (_ requests)
                  (maphash (lambda (_ request)
                             (cancel-timer (org-roam-ui-settings--request-timer request)))
                           requests))
                org-roam-ui-settings--pending)
       (when-let* ((buffer (find-buffer-visiting org-roam-ui-settings-file)))
         (with-current-buffer buffer (set-buffer-modified-p nil))
         (kill-buffer buffer))
       (delete-directory directory t))))

(defun org-roam-ui-settings-test--send (socket command &rest data)
  (org-roam-ui-settings-handle-message
   socket (json-serialize (org-roam-ui-settings--object
                          "command" command "data" (apply #'org-roam-ui-settings--object data))
                         :false-object :false :null-object :null)))

(ert-deftest org-roam-ui-settings-file-round-trip-preserves-false-and-nondefaults ()
  (org-roam-ui-settings-test--session
    (let ((settings (org-roam-ui-settings-test--document
                     "3d" :false "showTweaks" :false
                     "physics" (org-roam-ui-settings--object "enabled" :false "charge" -42)
                     "tagCols" (org-roam-ui-settings--object "study" "red.500"))))
      (org-roam-ui-settings--write settings)
      (let* ((restored (org-roam-ui-settings--read-json org-roam-ui-settings-file))
             (preferences (gethash "preferences" restored)))
        (should (eq (gethash "3d" preferences) :false))
        (should (= (gethash "charge" (gethash "physics" preferences)) -42))
        (should (equal (gethash "study" (gethash "tagCols" preferences)) "red.500"))))))

(ert-deftest org-roam-ui-settings-invalid-payload-does-not-replace-file ()
  (org-roam-ui-settings-test--session
    (org-roam-ui-settings--write (org-roam-ui-settings-test--document "3d" t))
    (let ((before (with-temp-buffer (insert-file-contents org-roam-ui-settings-file) (buffer-string))))
      (should-error (org-roam-ui-settings--write
                     (org-roam-ui-settings-test--document "3d" "yes")))
      (should-error (org-roam-ui-settings--write
                     (org-roam-ui-settings-test--document "graph" ["private-note-id"])))
      (should (equal before (with-temp-buffer
                              (insert-file-contents org-roam-ui-settings-file) (buffer-string)))))))

(ert-deftest org-roam-ui-settings-json-order-is-deterministic ()
  (org-roam-ui-settings-test--session
    (org-roam-ui-settings--write (org-roam-ui-settings-test--document "3d" t "outline" :false))
    (let ((before (with-temp-buffer (insert-file-contents org-roam-ui-settings-file) (buffer-string))))
      (org-roam-ui-settings--write (org-roam-ui-settings-test--document "outline" :false "3d" t))
      (should (equal before (with-temp-buffer
                              (insert-file-contents org-roam-ui-settings-file) (buffer-string)))))))

(ert-deftest org-roam-ui-settings-pending-request-survives-websocket-mutation ()
  (org-roam-ui-settings-test--session
    (let ((request (org-roam-ui-settings--expect socket "request-1" "save" 'emacs)))
      (aset socket 2 "incoming frame changed the mutable websocket")
      (should (eq (org-roam-ui-settings--lookup socket "request-1") request))
      (org-roam-ui-settings--finish request)
      (should-not (org-roam-ui-settings--lookup socket "request-1")))))

(ert-deftest org-roam-ui-settings-probes-do-not-steal-the-browser-target ()
  (org-roam-ui-settings-test--session
    (org-roam-ui-settings-test--send socket "settings-ready")
    (let ((org-roam-ui-ws-socket (vector 'websocket 'open "probe")))
      (should (eq (org-roam-ui-settings--target) socket)))))

(ert-deftest org-roam-ui-settings-snapshot-must-match-requesting-connection ()
  (org-roam-ui-settings-test--session
    (org-roam-ui-settings--expect socket "request-1" "save" 'emacs)
    (org-roam-ui-settings-test--send
     (vector 'websocket 'open "other browser") "settings-snapshot"
     "requestId" "request-1" "settings" (org-roam-ui-settings-test--document "3d" t))
    (should-not (file-exists-p org-roam-ui-settings-file))
    (org-roam-ui-settings-test--send
     socket "settings-snapshot" "requestId" "request-1"
     "settings" (org-roam-ui-settings-test--document "3d" :false))
    (should (file-exists-p org-roam-ui-settings-file))
    (should-not (org-roam-ui-settings--lookup socket "request-1"))))

(ert-deftest org-roam-ui-settings-disconnected-emacs-command-is-actionable ()
  (org-roam-ui-settings-test--session
    (should-error (org-roam-ui-save-settings) :type 'user-error)
    (should-not (file-exists-p org-roam-ui-settings-file))))

(ert-deftest org-roam-ui-settings-disconnect-and-timeout-cancel-pending-requests ()
  (org-roam-ui-settings-test--session
    (org-roam-ui-settings--expect socket "first" "save" 'emacs)
    (org-roam-ui-settings--timeout socket "first")
    (should-not (org-roam-ui-settings--lookup socket "first"))
    (org-roam-ui-settings--expect socket "second" "restore" 'emacs)
    (org-roam-ui-settings-disconnect socket)
    (should-not (org-roam-ui-settings--lookup socket "second"))))

(ert-deftest org-roam-ui-settings-restore-waits-for-browser-acknowledgment ()
  (org-roam-ui-settings-test--session
    (org-roam-ui-settings--write (org-roam-ui-settings-test--document "3d" :false))
    (org-roam-ui-settings-test--send socket "settings-restore" "requestId" "restore-1")
    (should (equal (gethash "type" (cdar sent)) "settings-apply"))
    (should (eq (caar sent) socket))
    (should (org-roam-ui-settings--lookup socket "restore-1"))
    (org-roam-ui-settings-test--send socket "settings-applied" "requestId" "restore-1" "ok" t)
    (should (equal (gethash "type" (cdar sent)) "settings-result"))
    (should (eq (gethash "ok" (gethash "data" (cdar sent))) t))
    (should-not (org-roam-ui-settings--lookup socket "restore-1"))))

(ert-deftest org-roam-ui-settings-unsaved-file-buffer-is-preserved ()
  (org-roam-ui-settings-test--session
    (org-roam-ui-settings--write (org-roam-ui-settings-test--document "3d" t))
    (let ((buffer (find-file-noselect org-roam-ui-settings-file)))
      (with-current-buffer buffer (goto-char (point-max)) (insert "unsaved work"))
      (should-error (org-roam-ui-settings--write (org-roam-ui-settings-test--document "3d" :false)))
      (should (buffer-modified-p buffer))
      (should (eq (gethash "3d" (gethash "preferences" (org-roam-ui-settings--read-json org-roam-ui-settings-file))) t)))))

(ert-deftest org-roam-ui-settings-unmodified-file-buffer-is-refreshed ()
  (org-roam-ui-settings-test--session
    (org-roam-ui-settings--write (org-roam-ui-settings-test--document "3d" t))
    (let ((buffer (find-file-noselect org-roam-ui-settings-file)))
      (org-roam-ui-settings--write (org-roam-ui-settings-test--document "3d" :false))
      (with-current-buffer buffer
        (should-not (buffer-modified-p))
        (should (string-match-p "false" (buffer-string)))))))

(ert-deftest org-roam-ui-settings-loads-saved-file-on-first-browser-ready ()
  (org-roam-ui-settings-test--session
    (org-roam-ui-settings--write (org-roam-ui-settings-test--document "3d" :false))
    (org-roam-ui-settings-test--send socket "settings-ready" "loadSaved" t)
    (let* ((response (cdar sent))
           (data (gethash "data" response)))
      (should (equal (gethash "type" response) "settings-apply"))
      (should (eq (gethash "3d" (gethash "preferences" (gethash "settings" data))) :false))
      (org-roam-ui-settings-test--send socket "settings-applied"
                                     "requestId" (gethash "requestId" data) "ok" t)
      (should (zerop (hash-table-count org-roam-ui-settings--pending))))))

(ert-deftest org-roam-ui-settings-missing-file-keeps-existing-browser-preferences ()
  (org-roam-ui-settings-test--session
    (org-roam-ui-settings-test--send socket "settings-ready" "loadSaved" t)
    (should-not sent)
    (should-not (file-exists-p org-roam-ui-settings-file))
    (should (eq (org-roam-ui-settings--target) socket))))

(ert-deftest org-roam-ui-settings-invalid-file-on-load-is-reported-without-applying ()
  (org-roam-ui-settings-test--session
    (with-temp-file org-roam-ui-settings-file (insert "{bad json"))
    (org-roam-ui-settings-test--send socket "settings-ready" "loadSaved" t)
    (should (equal (gethash "type" (cdar sent)) "settings-result"))
    (should (eq (gethash "ok" (gethash "data" (cdar sent))) :false))
    (should (zerop (hash-table-count org-roam-ui-settings--pending)))))

(ert-deftest org-roam-ui-settings-reconnection-does-not-reset-unsaved-preferences ()
  (org-roam-ui-settings-test--session
    (org-roam-ui-settings--write (org-roam-ui-settings-test--document "3d" t))
    (org-roam-ui-settings-test--send socket "settings-ready" "loadSaved" :false)
    (should-not sent)))

/**
 * Product Customizer — Accordion step logic, validation, and form integration.
 *
 * Each step is a <details> element. Completing a step collapses it and opens
 * the next one.  All values are written to hidden inputs with
 * name="properties[Label]" so Shopify includes them in the line item.
 *
 * Supports nested conditional branching (e.g. coin type → temple mode)
 * via .ls-conditional[data-*] wrappers. Only steps inside active conditionals
 * (or outside any conditional) are counted for progress / CTA.
 */

(function () {
  'use strict';

  /* ------------------------------------------------------------------
     Utilities
  ------------------------------------------------------------------ */

  function qs(sel, root) {
    return (root || document).querySelector(sel);
  }
  function qsa(sel, root) {
    return Array.from((root || document).querySelectorAll(sel));
  }

  /** Convert kebab-case to camelCase for dataset access */
  function toCamel(s) {
    return s.replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); });
  }

  /* ------------------------------------------------------------------
     LsProductCustomizer — one instance per section
  ------------------------------------------------------------------ */

  class LsProductCustomizer {
    /**
     * @param {HTMLElement} el  The .ls-customizer root element
     */
    constructor(el) {
      this.root = el;
      this.cta = qs('.ls-cta', el);
      this.progressEl = qs('.ls-progress', el);
      this.formId = el.dataset.formId || '';
      this.customizerType = el.dataset.customizerType || '';

      this._bindStepInputs();
      this._bindFileUploads();
      this._bindConditionals();
      this._bindURLParams();
      this._bindFormSubmit();
      this._renumberSteps();
      this._updateProgress();
      this._updateCTA();

      // Auto-open first incomplete step
      this._openFirstIncomplete();

      // Relocate customizer into product-details column on desktop
      this._relocateCustomizer();
    }

    /* ---- Visible steps (excludes steps inside hidden conditionals) ---- */

    _getVisibleSteps() {
      var root = this._stepsRoot || this.root;
      return qsa('.ls-step', root).filter(function (step) {
        // Walk up from the step to the root, checking every .ls-conditional ancestor
        var el = step.parentElement;
        while (el && el !== root) {
          if (el.classList.contains('ls-conditional') && !el.classList.contains('is-active')) {
            return false;
          }
          el = el.parentElement;
        }
        // Also hide pre-filled steps
        if (step.classList.contains('ls-step--prefilled')) return false;
        return true;
      });
    }

    /* ---- Dynamic step renumbering ---- */

    _renumberSteps() {
      var visibleSteps = this._getVisibleSteps();
      visibleSteps.forEach(function (step, i) {
        var num = i + 1;
        var numberEl = qs('.ls-step__number', step);
        var titleEl = qs('.ls-step__title', step);
        if (numberEl) numberEl.textContent = num;
        if (titleEl) {
          // Replace leading "N. " with new number
          titleEl.textContent = titleEl.textContent.replace(/^\d+\.\s*/, num + '. ');
        }
        step.setAttribute('data-step', num);
      });
    }

    /* ---- Step input binding ---- */

    _bindStepInputs() {
      var allSteps = qsa('.ls-step', this.root);
      allSteps.forEach(function (step) {
        var inputs = qsa('input, select, textarea', step);
        inputs.forEach(function (input) {
          if (input.type === 'file') return; // handled separately
          input.addEventListener('change', this._onInputChange.bind(this, step, input));
          if (input.tagName === 'TEXTAREA' || input.type === 'text') {
            input.addEventListener('input', this._onTextInput.bind(this, step, input));
          }
        }.bind(this));
      }.bind(this));
    }

    _onInputChange(step, input) {
      var propName = input.name;
      var value = input.value;

      // For radio/checkbox groups, find the checked value
      if (input.type === 'radio') {
        var checked = qs('input[name="' + propName + '"]:checked', step);
        value = checked ? checked.value : '';
      }

      // Update the step's selection display
      var selectionEl = qs('.ls-step__selection', step);
      if (selectionEl && value) {
        selectionEl.textContent = value;
      }

      // Check if step is complete
      this._checkStepCompletion(step);
    }

    _onTextInput(step, input) {
      // Update character count if present
      var counter = qs('.ls-text-field__char-count', input.closest('.ls-text-field'));
      if (counter) {
        var max = parseInt(input.getAttribute('maxlength'), 10) || 0;
        counter.textContent = input.value.length + (max ? ' / ' + max : '');
      }
    }

    /* ---- Step completion ---- */

    _checkStepCompletion(step) {
      var required = qsa('[required], [data-required]', step);
      var complete = true;

      required.forEach(function (input) {
        if (input.type === 'radio') {
          var groupName = input.name;
          var checked = qs('input[name="' + groupName + '"]:checked', step);
          if (!checked) complete = false;
        } else if (input.type === 'file') {
          if (!input.files || !input.files.length) complete = false;
        } else if (input.tagName === 'SELECT') {
          if (!input.value) complete = false;
        } else {
          if (!input.value.trim()) complete = false;
        }
      });

      if (complete && required.length > 0) {
        this._markComplete(step);
      } else {
        step.removeAttribute('data-completed');
      }

      this._updateProgress();
      this._updateCTA();
    }

    _markComplete(step) {
      step.setAttribute('data-completed', '');

      // Auto-advance: close current, open next visible step after a short delay
      var self = this;
      setTimeout(function () {
        step.removeAttribute('open');
        var visibleSteps = self._getVisibleSteps();
        var idx = visibleSteps.indexOf(step);
        if (idx !== -1 && idx + 1 < visibleSteps.length) {
          var next = visibleSteps[idx + 1];
          if (!next.hasAttribute('data-completed')) {
            next.setAttribute('open', '');
          }
        }
      }, 300);
    }

    /* ---- Progress ---- */

    _updateProgress() {
      var visibleSteps = this._getVisibleSteps();
      var total = visibleSteps.length;
      var completed = visibleSteps.filter(function (s) {
        return s.hasAttribute('data-completed');
      }).length;
      var searchRoot = this._stepsRoot || this.root;
      var textEl = qs('.ls-progress__text', searchRoot);
      var fillEl = qs('.ls-progress__fill', searchRoot);
      if (textEl) textEl.textContent = 'Step ' + Math.min(completed + 1, total) + ' of ' + total;
      if (fillEl) fillEl.style.width = (total > 0 ? (completed / total) * 100 : 0) + '%';
    }

    /* ---- CTA ---- */

    _updateCTA() {
      if (!this.cta) return;
      var visibleSteps = this._getVisibleSteps();
      var total = visibleSteps.length;
      var completed = visibleSteps.filter(function (s) {
        return s.hasAttribute('data-completed');
      }).length;
      var allDone = completed === total && total > 0;

      this.cta.disabled = !allDone;

      if (allDone) {
        this.cta.textContent = 'Add to Cart';
      } else {
        var remaining = total - completed;
        this.cta.textContent = 'Complete ' + (remaining === 1 ? 'Last Step' : 'All ' + remaining + ' Steps') + ' to Add to Cart';
      }
    }

    /* ---- File uploads ---- */

    _bindFileUploads() {
      var uploads = qsa('.ls-file-upload', this.root);
      uploads.forEach(function (uploadEl) {
        var dropzone = qs('.ls-file-upload__dropzone', uploadEl);
        var input = qs('input[type="file"]', uploadEl);
        var preview = qs('.ls-file-upload__preview', uploadEl);
        var thumb = qs('.ls-file-upload__thumb', uploadEl);
        var nameEl = qs('.ls-file-upload__name', uploadEl);
        var sizeEl = qs('.ls-file-upload__size', uploadEl);
        var removeBtn = qs('.ls-file-upload__remove', uploadEl);

        if (!dropzone || !input) return;

        // Click to upload
        dropzone.addEventListener('click', function () {
          input.click();
        });

        // Drag & drop
        dropzone.addEventListener('dragover', function (e) {
          e.preventDefault();
          dropzone.classList.add('is-dragover');
        });
        dropzone.addEventListener('dragleave', function () {
          dropzone.classList.remove('is-dragover');
        });
        dropzone.addEventListener('drop', function (e) {
          e.preventDefault();
          dropzone.classList.remove('is-dragover');
          if (e.dataTransfer.files.length) {
            input.files = e.dataTransfer.files;
            input.dispatchEvent(new Event('change', { bubbles: true }));
          }
        });

        // File selected
        input.addEventListener('change', function () {
          var file = input.files[0];
          if (!file) return;

          // Show preview
          if (preview) {
            preview.classList.add('is-visible');
            dropzone.style.display = 'none';
          }
          if (nameEl) nameEl.textContent = file.name;
          if (sizeEl) sizeEl.textContent = _formatFileSize(file.size);

          // Thumbnail
          if (thumb && file.type.startsWith('image/')) {
            var reader = new FileReader();
            reader.onload = function (e) {
              thumb.src = e.target.result;
            };
            reader.readAsDataURL(file);
          }

          // Update selection text in header
          var step = uploadEl.closest('.ls-step');
          var selectionEl = qs('.ls-step__selection', step);
          if (selectionEl) selectionEl.textContent = file.name;

          // Check step completion
          if (step) this._checkStepCompletion(step);
        }.bind(this));

        // Remove file
        if (removeBtn) {
          removeBtn.addEventListener('click', function () {
            input.value = '';
            if (preview) {
              preview.classList.remove('is-visible');
              dropzone.style.display = '';
            }
            if (thumb) thumb.src = '';

            var step = uploadEl.closest('.ls-step');
            var selectionEl = qs('.ls-step__selection', step);
            if (selectionEl) selectionEl.textContent = '';

            if (step) {
              step.removeAttribute('data-completed');
              this._updateProgress();
              this._updateCTA();
            }
          }.bind(this));
        }
      }.bind(this));
    }

    /* ---- URL params pre-fill ---- */

    _bindURLParams() {
      var params = new URLSearchParams(window.location.search);

      params.forEach(function (value, key) {
        // Find inputs whose property name matches
        var inputs = qsa('input[value="' + CSS.escape(value) + '"]', this.root);
        inputs.forEach(function (input) {
          var propKey = (input.name || '').replace('properties[', '').replace(']', '');
          if (propKey.toLowerCase().replace(/\s+/g, '_') === key.toLowerCase().replace(/\s+/g, '_')) {
            input.checked = true;
            input.dispatchEvent(new Event('change', { bubbles: true }));
          }
        });

        // Also handle select elements
        var selects = qsa('select', this.root);
        selects.forEach(function (select) {
          var propKey = (select.name || '').replace('properties[', '').replace(']', '');
          if (propKey.toLowerCase().replace(/\s+/g, '_') === key.toLowerCase().replace(/\s+/g, '_')) {
            select.value = value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
          }
        });
      }.bind(this));

      // Coin type URL pre-fill — hide Step 1 if pre-filled
      var coinType = params.get('coin_type');
      if (coinType && this.customizerType === 'coin') {
        // Find the coin type step (Step 1) and hide it
        var step1 = qs('.ls-step[data-step="1"]', this.root);
        if (step1) {
          step1.classList.add('ls-step--prefilled');
          step1.setAttribute('data-completed', '');
          step1.removeAttribute('open');
        }
        // Activate the coin type conditional
        this._activateConditional('coin-type', coinType);
      }

      // Default to Missionary if no coin_type URL param
      if (!coinType && this.customizerType === 'coin') {
        var defaultType = 'missionary';
        var defaultRadio = qs('input[data-coin-type="' + defaultType + '"]', this.root);
        if (defaultRadio) {
          defaultRadio.checked = true;
          var step = defaultRadio.closest('.ls-step');
          if (step) {
            var selectionEl = qs('.ls-step__selection', step);
            if (selectionEl) selectionEl.textContent = defaultRadio.value;
          }
        }
        this._activateConditional('coin-type', defaultType);
      }
    }

    /* ---- Generic conditional branching ---- */

    _bindConditionals() {
      // Find all inputs that have conditional data attributes
      var condGroups = ['coin-type', 'temple-mode', 'sports-mode', 'shadow-box-occasion', 'desktop-plaque-occasion', 'puzzle-shape', 'print-media-material'];
      condGroups.forEach(function (group) {
        var camel = toCamel(group);
        var inputs = qsa('[data-' + group + ']', this.root);
        inputs.forEach(function (input) {
          input.addEventListener('change', function () {
            if (input.checked) {
              this._activateConditional(group, input.dataset[camel]);
            }
          }.bind(this));
        }.bind(this));
      }.bind(this));
    }

    _activateConditional(group, value) {
      var attr = 'data-' + group;
      var searchRoot = this._stepsRoot || this.root;
      var conditionals = qsa('.ls-conditional[' + attr + ']', searchRoot);
      conditionals.forEach(function (el) {
        if (el.getAttribute(attr) === value) {
          el.classList.add('is-active');
        } else {
          el.classList.remove('is-active');
          // Reset completed state and close steps inside deactivated conditionals
          qsa('.ls-step', el).forEach(function (step) {
            step.removeAttribute('data-completed');
            step.removeAttribute('open');
          });
          // Also deactivate any nested sub-conditionals
          qsa('.ls-conditional', el).forEach(function (nested) {
            nested.classList.remove('is-active');
          });
        }
      });

      // Renumber, recalculate progress and CTA
      this._renumberSteps();
      this._updateProgress();
      this._updateCTA();

      // Open first incomplete visible step after conditional change
      var visibleSteps = this._getVisibleSteps();
      for (var i = 0; i < visibleSteps.length; i++) {
        if (!visibleSteps[i].hasAttribute('data-completed')) {
          visibleSteps[i].setAttribute('open', '');
          break;
        }
      }
    }

    /* ---- Form submission (fetch, matches theme pattern) ---- */

    _bindFormSubmit() {
      var form = qs('#' + this.formId);
      if (!form) return;
      var self = this;

      function submitFormData(formData) {
        fetch('/cart/add.js', {
          method: 'POST',
          body: formData
        })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data.status) {
            alert(data.description || data.message || 'Could not add to cart.');
            self._updateCTA();
            return;
          }

          self.cta.textContent = 'Added to Cart!';

          /* Fetch fresh cart to get item_count, then trigger theme cart drawer */
          fetch('/cart.js').then(function (r) { return r.json(); }).then(function (cart) {
            document.dispatchEvent(new CustomEvent('cart:update', {
              bubbles: true,
              detail: {
                resource: cart,
                sourceId: self.formId,
                data: {
                  itemCount: cart.item_count,
                  sections: {}
                }
              }
            }));

          });

          setTimeout(function () {
            self._updateCTA();
          }, 1200);
        })
        .catch(function () {
          alert('Something went wrong. Please try again.');
          self._updateCTA();
        });
      }

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        if (self.cta && self.cta.disabled) return;

        var formData = new FormData(form);
        self.cta.disabled = true;
        self.cta.textContent = 'Adding...';

        // Export canvas preview(s) as JPEG files before submitting
        var preview = self.root._lsPreview;
        if (preview && preview.canvas && preview.photoImage) {
          preview.canvas.toCanvasElement().toBlob(function (blob) {
            if (blob) {
              formData.append('properties[_Preview]', new File([blob], 'preview.jpg', { type: 'image/jpeg' }));
            }

            // For coins: also export back canvas
            if (preview.backCanvas && preview.backPhotoImage) {
              preview.backCanvas.toCanvasElement().toBlob(function (backBlob) {
                if (backBlob) {
                  formData.append('properties[_Preview Back]', new File([backBlob], 'preview-back.jpg', { type: 'image/jpeg' }));
                }
                submitFormData(formData);
              }, 'image/jpeg', 0.85);
            } else {
              submitFormData(formData);
            }
          }, 'image/jpeg', 0.85);
        } else {
          submitFormData(formData);
        }
      });
    }

    /* ---- Relocate customizer into product-details column (desktop only) ---- */

    _relocateCustomizer() {
      if (window.innerWidth < 750) return;

      var detailsCol = document.querySelector('.product-details .group-block-content');
      if (!detailsCol) return;

      // Find the accordion element to insert before
      var accordion = detailsCol.querySelector('.accordion');

      // Collect our customizer content: top-level steps, conditionals, progress, CTA, trust badges
      // Only grab direct children to preserve nesting (steps inside conditionals stay nested)
      var children = Array.from(this.root.children).filter(function (el) {
        return el.classList.contains('ls-step') || el.classList.contains('ls-conditional');
      });
      var progress = qs('.ls-progress', this.root);
      var cta = this.cta;
      var trustBadges = qs('.ls-trust-badges', this.root);

      // Create a wrapper to hold relocated content
      var wrapper = document.createElement('div');
      wrapper.className = 'ls-customizer-relocated';

      // Move steps and conditionals (preserving nesting)
      children.forEach(function (el) {
        wrapper.appendChild(el);
      });

      // Move progress, CTA, trust badges
      if (progress) wrapper.appendChild(progress);
      if (cta) wrapper.appendChild(cta);
      if (trustBadges) wrapper.appendChild(trustBadges);

      // Insert before accordion, or append at end
      if (accordion) {
        accordion.parentNode.insertBefore(wrapper, accordion);
      } else {
        detailsCol.appendChild(wrapper);
      }

      // Track the new root for step queries
      this._stepsRoot = wrapper;

      // Mark the original section as relocated
      this.root.classList.add('ls-customizer--relocated');

      // Hide the original section container if it's now empty (just form + preview)
      var section = this.root.closest('.ls-product-customizer-section');
      if (section) section.style.display = 'none';
    }

    /* ---- Open first incomplete step ---- */

    _openFirstIncomplete() {
      var visibleSteps = this._getVisibleSteps();
      for (var i = 0; i < visibleSteps.length; i++) {
        if (!visibleSteps[i].hasAttribute('data-completed')) {
          visibleSteps[i].setAttribute('open', '');
          return;
        }
      }
    }
  }

  /* ---- Helpers ---- */

  function _formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  /* ------------------------------------------------------------------
     LsPreview — Live product preview driven by customizer inputs
  ------------------------------------------------------------------ */

  /** Maps option labels to CSS custom property values */
  var OPTION_MAPS = {
    frameColor: {
      'Black':        '#1a1a1a',
      'White':        '#f5f5f5',
      'Walnut':       '#5C4033',
      'Natural Oak':  '#C4A882',
      'Natural Wood': '#C4A882',
      'Cherry':       '#7B3F00',
      'Classic Black':'#1a1a1a',
      'None':         'transparent'
    },
    shape: {
      'Heart':       "path('M 50 85 C 25 65, 0 45, 0 25 C 0 5, 20 0, 35 0 C 42 0, 50 8, 50 15 C 50 8, 58 0, 65 0 C 80 0, 100 5, 100 25 C 100 45, 75 65, 50 85 Z')",
      'Rectangle':   'inset(0 round 4px)',
      'Rectangular': 'inset(0 round 4px)',
      'Oval':        'ellipse(45% 50%)',
      'Circle':      'circle(50%)',
      'Round':       'circle(50%)',
      'Star':        'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)',
      'Arch':        'polygon(0% 100%, 0% 30%, 5% 18%, 15% 8%, 25% 3%, 35% 0.5%, 50% 0%, 65% 0.5%, 75% 3%, 85% 8%, 95% 18%, 100% 30%, 100% 100%)',
      'Diamond':     'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
      'Classic':     'inset(0 round 4px)',
      'Modern':      'inset(0 round 4px)'
    },
    finish: {
      'Gold':   'radial-gradient(circle, #D4AF37 0%, #B8860B 50%, #DAA520 100%)',
      'Silver': 'radial-gradient(circle, #C0C0C0 0%, #A8A8A8 50%, #D3D3D3 100%)'
    },
    woodBase: {
      'Walnut with LED':  '#5C4033',
      'Maple with LED':   '#C4A882',
      'Black with LED':   '#1a1a1a',
      'No Base':          'transparent',
      'Walnut':           '#5C4033',
      'Maple':            '#C4A882',
      'Beech':            '#D2B48C',
      'Cherry':           '#7B3F00',
      'Black':            '#1a1a1a'
    },
    material: {
      'Canvas': '#d4cfc8',
      'Metal':  'linear-gradient(135deg, #b0b0b0, #d8d8d8, #a0a0a0)',
      'Maple':  '#C4A882',
      'Walnut': '#5C4033',
      'Wood':   '#A0845C'
    },
    style: {
      '3 Panel Set':  'inset(0 round 4px)',
      'Brush Stroke': 'inset(0 round 4px)',
      'Silhouette':   'inset(0 round 4px)',
      'Line Drawing': 'inset(0 round 4px)',
      'Full Color':   'inset(0 round 4px)'
    },
    letterStyle: {
      'Flat':   'none',
      'Raised': 'none',
      '3D':     'none'
    }
  };

  /** Maps property names to which CSS variable and lookup map to use */
  var PROPERTY_TO_CSS = {
    'Frame Color':           { prop: '--ls-frame-color', map: 'frameColor' },
    'Frame Style':           { prop: '--ls-frame-color', map: 'frameColor' },
    'Shape':                 { prop: '--ls-shape',       map: 'shape' },
    'Style':                 { prop: '--ls-shape',       map: 'shape' },
    'Finish':                { prop: '--ls-finish-gradient', map: 'finish' },
    'Wood Base & Lighting':  { prop: '--ls-base-color',  map: 'woodBase' },
    'Wood Base':             { prop: '--ls-base-color',  map: 'woodBase' },
    'Colors':                { prop: '--ls-accent-color', map: null },
    'Text Color':            { prop: '--ls-accent-color', map: null },
    'Material':              { prop: '--ls-frame-color', map: 'material' },
    'Art Style':             { prop: '--ls-art-style',    map: 'style' },
    'Color Style':           { prop: '--ls-color-style',  map: 'style' },
    'Letter Style':          { prop: '--ls-letter-style', map: 'letterStyle' },
    'Wood Type':             { prop: '--ls-base-color',   map: 'woodBase' },
    'Lighting':              { prop: '--ls-lighting',     map: null },
    'Frame':                 { prop: '--ls-frame-color',  map: 'frameColor' },
    'Template':              { prop: '--ls-template',     map: null },
    'Canvas Style':          { prop: '--ls-shape',        map: 'style' }
  };

  /* ------------------------------------------------------------------
     Preview type configurations for fabric.js canvas
  ------------------------------------------------------------------ */

  var PREVIEW_CONFIG = {
    'print-media': {
      aspect: 1662 / 1293,
      overlay: true,
      photoWindow: { top: 0.1732, left: 0.1907, width: 0.6264, height: 0.6249 }
    },
    'shadow-box': {
      aspect: 3461 / 4096,
      overlay: true,
      photoWindow: { top: 0.1426, left: 0.1632, width: 0.6755, height: 0.7092 }
    },
    'light-box': {
      aspect: 1,
      clipShape: 'fromVar',
      photoWindow: null
    },
    'desktop-plaque': {
      aspect: 1,
      clipShape: 'fromVar',
      photoWindow: null
    },
    'coin': {
      aspect: 1,
      clipShape: 'circle',
      clipRadius: 0.44,
      photoWindow: null
    },
    'missionary-plaque': {
      aspect: 4 / 5,
      border: { width: 10, colorVar: '--ls-base-color' },
      photoWindow: null
    },
    'missionary-canvas': {
      aspect: 4 / 5,
      border: { width: 6, colorFixed: '#d4cfc8' },
      photoWindow: null
    },
    'temple-canvas': {
      aspect: 4 / 5,
      border: { width: 6, colorFixed: '#d4cfc8' },
      photoWindow: null
    },
    'temple-wall-art': {
      aspect: 4 / 5,
      border: { width: 6, colorVar: '--ls-frame-color' },
      photoWindow: null
    },
    'temple-night-light': {
      aspect: 1,
      clipShape: 'fromVar',
      photoWindow: null
    },
    'puzzle': {
      aspect: 1,
      clipShape: 'fromVar',
      photoWindow: null
    },
    'vinyl-record': {
      aspect: 1,
      clipShape: 'circle',
      clipRadius: 0.36,
      photoWindow: null
    },
    'school-frame': {
      aspect: 3 / 2,
      border: { width: 8, colorVar: '--ls-frame-color' },
      photoWindow: null
    },
    'sports-display': {
      aspect: 1,
      border: { width: 6, colorVar: '--ls-accent-color' },
      photoWindow: null
    },
    'acrylic-block': {
      aspect: 1,
      clipShape: 'fromVar',
      photoWindow: null
    }
  };

  class LsPreview {
    constructor(root) {
      this.root = root;
      this.previewEl = qs('.ls-preview', root);
      if (!this.previewEl) return;

      this.type = this.previewEl.dataset.previewType;
      this.config = PREVIEW_CONFIG[this.type] || { aspect: 1, photoWindow: null };
      this.baseEl = qs('.ls-preview__base', this.previewEl);
      this.controlsEl = qs('.ls-preview__controls', this.previewEl);

      // Canvas references (initialized after fabric.js loads)
      this.canvas = null;
      this.backCanvas = null;
      this.photoImage = null;
      this.backPhotoImage = null;
      this._activeFace = 'front';

      this._relocatePreview();
      this._bindCloseButton();
      this._waitForFabric();
      this._bindOptionChanges();
      this._bindCoinToggle();
    }

    /** Wait for fabric.js to load (it's deferred), then initialize canvases */
    _waitForFabric() {
      var self = this;
      if (typeof fabric !== 'undefined') {
        self._initCanvases();
        self._bindPhotoUploads();
        self._bindControls();
        return;
      }
      // Poll until fabric is available
      var attempts = 0;
      var poll = setInterval(function () {
        attempts++;
        if (typeof fabric !== 'undefined') {
          clearInterval(poll);
          self._initCanvases();
          self._bindPhotoUploads();
          self._bindControls();
        } else if (attempts > 100) {
          clearInterval(poll);
        }
      }, 100);
    }

    _initCanvases() {
      var frontCanvasEl = qs('.ls-preview__canvas[data-face="front"]', this.previewEl);
      if (!frontCanvasEl) return;

      this.canvas = this._createCanvas(frontCanvasEl);

      // Back canvas for coins
      var backCanvasEl = qs('.ls-preview__canvas--back', this.previewEl);
      if (backCanvasEl) {
        this.backCanvas = this._createCanvas(backCanvasEl);
      }
    }

    _createCanvas(canvasEl) {
      var frameEl = canvasEl.closest('.ls-preview__frame');
      var width = frameEl.clientWidth || 320;
      var height = Math.round(width / this.config.aspect);

      canvasEl.width = width;
      canvasEl.height = height;

      var canvas = new fabric.Canvas(canvasEl, {
        width: width,
        height: height,
        backgroundColor: '#e5e1dc',
        selection: false,
        allowTouchScrolling: true,
        controlsAboveOverlay: false
      });

      // Load frame overlay as foreground image
      if (this.config.overlay) {
        var overlaySrc = qs('.ls-preview__overlay', this.previewEl);
        if (overlaySrc) {
          var self = this;
          fabric.FabricImage.fromURL(overlaySrc.src, { crossOrigin: 'anonymous' }).then(function (img) {
            img.scaleToWidth(canvas.width);
            canvas.set('overlayImage', img);
            canvas.renderAll();
          });
          // Hide the HTML overlay since canvas handles it
          overlaySrc.style.display = 'none';
        }
      }

      // Draw decorative elements for specific types
      this._drawDecorations(canvas);

      return canvas;
    }

    /** Draw per-type decorations (borders, coin rim, vinyl grooves, etc.) */
    _drawDecorations(canvas) {
      var w = canvas.width;
      var h = canvas.height;

      if (this.config.border) {
        var bw = this.config.border.width;
        var color = this.config.border.colorFixed
          || getComputedStyle(this.previewEl).getPropertyValue(this.config.border.colorVar).trim()
          || '#1a1a1a';
        var borderRect = new fabric.Rect({
          left: 0, top: 0, width: w, height: h,
          fill: 'transparent',
          stroke: color,
          strokeWidth: bw * 2,
          selectable: false, evented: false
        });
        canvas.add(borderRect);
        canvas.bringObjectToFront(borderRect);
        // Store reference for color updates
        canvas._lsBorderRect = borderRect;
      }

      // Coin metallic rim
      if (this.type === 'coin') {
        var gradient = new fabric.Gradient({
          type: 'radial',
          coords: { x1: w / 2, y1: h / 2, r1: 0, x2: w / 2, y2: h / 2, r2: w / 2 },
          colorStops: [
            { offset: 0, color: '#D4AF37' },
            { offset: 0.5, color: '#B8860B' },
            { offset: 1, color: '#DAA520' }
          ]
        });
        var rim = new fabric.Circle({
          left: 0, top: 0, radius: w / 2,
          fill: gradient,
          selectable: false, evented: false
        });
        canvas.add(rim);
        canvas.sendObjectToBack(rim);
        canvas._lsCoinRim = rim;
      }

      // Vinyl record grooves
      if (this.type === 'vinyl-record') {
        var vinylBg = new fabric.Circle({
          left: 0, top: 0, radius: w / 2,
          fill: '#1a1a1a',
          selectable: false, evented: false
        });
        canvas.add(vinylBg);
        canvas.sendObjectToBack(vinylBg);
        // Center hole
        var hole = new fabric.Circle({
          left: w / 2 - w * 0.03, top: h / 2 - h * 0.03,
          radius: w * 0.03,
          fill: '#e5e1dc',
          selectable: false, evented: false
        });
        canvas.add(hole);
        canvas.bringObjectToFront(hole);
        canvas._lsVinylHole = hole;
      }
    }

    /** Move the preview into the product media column, hidden initially */
    _relocatePreview() {
      if (!this.previewEl) return;
      if (window.innerWidth < 750) return;

      var mediaCol = document.querySelector('.product-information__media');
      if (!mediaCol) return;

      this._gallery = mediaCol.querySelector('media-gallery');
      this._mediaCol = mediaCol;

      mediaCol.prepend(this.previewEl);
      this.previewEl.classList.add('ls-preview--relocated');
      this.previewEl.style.display = 'none';
    }

    _bindCloseButton() {
      var self = this;
      var closeBtn = qs('.ls-preview__close', this.previewEl);
      if (!closeBtn) return;

      closeBtn.addEventListener('click', function () {
        self._hidePreview();
      });
    }

    _showPreview() {
      if (!this.previewEl.classList.contains('ls-preview--relocated')) {
        // On mobile, just show controls
        if (this.controlsEl) this.controlsEl.classList.add('is-visible');
        return;
      }
      this.previewEl.style.display = '';
      if (this._gallery) this._gallery.style.display = 'none';
      if (this.controlsEl) this.controlsEl.classList.add('is-visible');
      // Remove return button if it exists
      if (this._returnBtn) {
        this._returnBtn.remove();
        this._returnBtn = null;
      }
    }

    _hidePreview() {
      if (this.controlsEl) this.controlsEl.classList.remove('is-visible');
      if (!this.previewEl.classList.contains('ls-preview--relocated')) return;
      this.previewEl.style.display = 'none';
      if (this._gallery) {
        this._gallery.style.display = '';
        // Show "Back to Preview" button on top of gallery if a photo has been uploaded
        if (this.photoImage || this.backPhotoImage) {
          this._showReturnButton();
        }
      }
    }

    _showReturnButton() {
      if (this._returnBtn) return; // already exists
      var self = this;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ls-preview__return';
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 12H3m0 0l4-4m-4 4l4 4"/><path d="M9 21h9a3 3 0 003-3V6a3 3 0 00-3-3H9"/></svg> Back to Preview';
      btn.addEventListener('click', function () {
        self._showPreview();
        if (self._returnBtn) {
          self._returnBtn.remove();
          self._returnBtn = null;
        }
      });
      this._mediaCol.insertBefore(btn, this._gallery);
      this._returnBtn = btn;
    }

    /** Get the active canvas (front or back for coins) */
    _getActiveCanvas() {
      if (this._activeFace === 'back' && this.backCanvas) return this.backCanvas;
      return this.canvas;
    }

    /** Get the active photo image */
    _getActivePhoto() {
      if (this._activeFace === 'back') return this.backPhotoImage;
      return this.photoImage;
    }

    _setActivePhoto(img) {
      if (this._activeFace === 'back') {
        this.backPhotoImage = img;
      } else {
        this.photoImage = img;
      }
    }

    /** Create a clip path for the photo based on preview type */
    _createClipPath(canvas) {
      var w = canvas.width;
      var h = canvas.height;
      var cfg = this.config;

      if (cfg.clipShape === 'circle' && cfg.clipRadius) {
        var r = Math.min(w, h) * cfg.clipRadius;
        return new fabric.Circle({
          radius: r,
          left: w / 2 - r,
          top: h / 2 - r,
          absolutePositioned: true
        });
      }

      if (cfg.border) {
        var bw = cfg.border.width;
        return new fabric.Rect({
          left: bw, top: bw,
          width: w - bw * 2,
          height: h - bw * 2,
          absolutePositioned: true
        });
      }

      if (cfg.photoWindow) {
        var pw = cfg.photoWindow;
        return new fabric.Rect({
          left: w * pw.left,
          top: h * pw.top,
          width: w * pw.width,
          height: h * pw.height,
          rx: 6, ry: 6,
          absolutePositioned: true
        });
      }

      // clipShape: 'fromVar' — read the current CSS --ls-shape and determine clip
      // Default to full canvas if no shape set
      var shapeVal = getComputedStyle(this.previewEl).getPropertyValue('--ls-shape').trim();
      if (shapeVal && shapeVal !== 'none') {
        return this._clipFromCssShape(shapeVal, w, h);
      }

      return null;
    }

    /** Parse CSS clip-path shape into a fabric.js clip path */
    _clipFromCssShape(shapeVal, w, h) {
      // circle(R%)
      var circleMatch = shapeVal.match(/circle\((\d+)%?\)/);
      if (circleMatch) {
        var pct = parseFloat(circleMatch[1]) / 100;
        var r = Math.min(w, h) * pct;
        return new fabric.Circle({
          radius: r,
          left: w / 2 - r,
          top: h / 2 - r,
          absolutePositioned: true
        });
      }

      // ellipse(Rx% Ry%)
      var ellipseMatch = shapeVal.match(/ellipse\((\d+)%\s+(\d+)%\)/);
      if (ellipseMatch) {
        var rx = w * parseFloat(ellipseMatch[1]) / 100;
        var ry = h * parseFloat(ellipseMatch[2]) / 100;
        return new fabric.Ellipse({
          rx: rx, ry: ry,
          left: w / 2 - rx,
          top: h / 2 - ry,
          absolutePositioned: true
        });
      }

      // inset(V round Rpx) — treat as rect
      var insetMatch = shapeVal.match(/inset\((\d+)/);
      if (insetMatch) {
        var insetVal = parseFloat(insetMatch[1]);
        return new fabric.Rect({
          left: insetVal, top: insetVal,
          width: w - insetVal * 2,
          height: h - insetVal * 2,
          rx: 4, ry: 4,
          absolutePositioned: true
        });
      }

      // polygon(...) — parse as SVG path-like points
      var polyMatch = shapeVal.match(/polygon\((.+)\)/);
      if (polyMatch) {
        var pointStr = polyMatch[1];
        var points = pointStr.split(',').map(function (pair) {
          var parts = pair.trim().split(/\s+/);
          return {
            x: parseFloat(parts[0]) / 100 * w,
            y: parseFloat(parts[1]) / 100 * h
          };
        });
        return new fabric.Polygon(points, {
          absolutePositioned: true
        });
      }

      // path(...) — heart shape etc., use a rect fallback
      if (shapeVal.indexOf('path(') !== -1) {
        // For complex SVG paths, use a generous rect as clip
        return new fabric.Rect({
          left: w * 0.05, top: w * 0.05,
          width: w * 0.9, height: h * 0.9,
          absolutePositioned: true
        });
      }

      return null;
    }

    /** Listen for file input changes and render photo on canvas */
    _bindPhotoUploads() {
      var self = this;
      var relocated = document.querySelector('.ls-customizer-relocated');
      var fileInputs = qsa('input[type="file"]', this.root);
      if (relocated) {
        fileInputs = fileInputs.concat(qsa('input[type="file"]', relocated));
      }

      fileInputs.forEach(function (input) {
        input.addEventListener('change', function () {
          var file = input.files[0];
          if (!file || !file.type.startsWith('image/')) return;

          var propName = (input.name || '').replace('properties[', '').replace(']', '');
          var isBack = propName.toLowerCase().indexOf('back') !== -1;

          // Set active face for coins
          if (self.type === 'coin' && isBack) {
            self._activeFace = 'back';
          } else {
            self._activeFace = 'front';
          }

          var reader = new FileReader();
          reader.onload = function (e) {
            self._addPhotoToCanvas(e.target.result);
          };
          reader.readAsDataURL(file);
        });

        // Handle file removal
        var uploadEl = input.closest('.ls-file-upload');
        if (uploadEl) {
          var removeBtn = qs('.ls-file-upload__remove', uploadEl);
          if (removeBtn) {
            removeBtn.addEventListener('click', function () {
              var propName = (input.name || '').replace('properties[', '').replace(']', '');
              var isBack = propName.toLowerCase().indexOf('back') !== -1;
              self._removePhoto(isBack ? 'back' : 'front');
            });
          }
        }
      });
    }

    /** Add a photo image to the active canvas */
    _addPhotoToCanvas(dataUrl) {
      var self = this;
      var canvas = this._getActiveCanvas();
      if (!canvas) return;

      // Remove existing photo if any
      var existing = this._getActivePhoto();
      if (existing) {
        canvas.remove(existing);
      }

      fabric.FabricImage.fromURL(dataUrl).then(function (img) {
        var w = canvas.width;
        var h = canvas.height;
        var cfg = self.config;

        // Calculate the photo window region
        var targetW, targetH, targetLeft, targetTop;
        if (cfg.photoWindow) {
          targetW = w * cfg.photoWindow.width;
          targetH = h * cfg.photoWindow.height;
          targetLeft = w * cfg.photoWindow.left;
          targetTop = h * cfg.photoWindow.top;
        } else if (cfg.border) {
          var bw = cfg.border.width;
          targetW = w - bw * 2;
          targetH = h - bw * 2;
          targetLeft = bw;
          targetTop = bw;
        } else {
          targetW = w;
          targetH = h;
          targetLeft = 0;
          targetTop = 0;
        }

        // Scale to cover the target region
        var scaleX = targetW / img.width;
        var scaleY = targetH / img.height;
        var scale = Math.max(scaleX, scaleY);

        img.set({
          scaleX: scale,
          scaleY: scale,
          left: targetLeft + targetW / 2,
          top: targetTop + targetH / 2,
          originX: 'center',
          originY: 'center',
          selectable: true,
          hasControls: true,
          hasBorders: true,
          lockUniScaling: true,
          cornerSize: 20,
          touchCornerSize: 36,
          cornerColor: '#c8a45d',
          cornerStrokeColor: '#fff',
          cornerStyle: 'circle',
          borderColor: '#c8a45d',
          transparentCorners: false,
          padding: 0
        });

        // Apply clip path
        var clipPath = self._createClipPath(canvas);
        if (clipPath) {
          img.clipPath = clipPath;
        }

        canvas.add(img);

        // Ensure decorations stay in correct z-order
        if (canvas._lsBorderRect) canvas.bringObjectToFront(canvas._lsBorderRect);
        if (canvas._lsVinylHole) canvas.bringObjectToFront(canvas._lsVinylHole);

        canvas.setActiveObject(img);
        canvas.renderAll();

        self._setActivePhoto(img);
        self._showPreview();
      });
    }

    /** Remove photo from a specific face */
    _removePhoto(face) {
      var canvas = face === 'back' ? this.backCanvas : this.canvas;
      var photo = face === 'back' ? this.backPhotoImage : this.photoImage;

      if (canvas && photo) {
        canvas.remove(photo);
        canvas.renderAll();
      }

      if (face === 'back') {
        this.backPhotoImage = null;
      } else {
        this.photoImage = null;
      }

      // If no photos remain on any canvas, hide preview
      if (!this.photoImage && !this.backPhotoImage) {
        this._hidePreview();
      }
    }

    /** Bind mobile control buttons */
    _bindControls() {
      var self = this;
      if (!this.controlsEl) return;

      var ctrls = qsa('.ls-preview__ctrl', this.controlsEl);
      ctrls.forEach(function (btn) {
        btn.addEventListener('click', function () {
          var action = btn.dataset.action;
          var canvas = self._getActiveCanvas();
          var photo = self._getActivePhoto();
          if (!canvas || !photo) return;

          var MOVE_PX = 5;
          var SCALE_STEP = 0.1;
          var ROTATE_DEG = 15;

          switch (action) {
            case 'up':
              photo.set('top', photo.top - MOVE_PX);
              break;
            case 'down':
              photo.set('top', photo.top + MOVE_PX);
              break;
            case 'left':
              photo.set('left', photo.left - MOVE_PX);
              break;
            case 'right':
              photo.set('left', photo.left + MOVE_PX);
              break;
            case 'zoom-in':
              photo.set('scaleX', photo.scaleX * (1 + SCALE_STEP));
              photo.set('scaleY', photo.scaleY * (1 + SCALE_STEP));
              break;
            case 'zoom-out':
              photo.set('scaleX', photo.scaleX * (1 - SCALE_STEP));
              photo.set('scaleY', photo.scaleY * (1 - SCALE_STEP));
              break;
            case 'rotate':
              photo.set('angle', (photo.angle + ROTATE_DEG) % 360);
              break;
            case 'replace':
              // Trigger the file input of the current face
              var relocated = document.querySelector('.ls-customizer-relocated');
              var searchRoot = relocated || self.root;
              var fileInputs = qsa('input[type="file"]', searchRoot);
              if (fileInputs.length > 0) {
                // For coins, pick the right input based on active face
                var targetInput = fileInputs[0];
                if (self._activeFace === 'back' && fileInputs.length > 1) {
                  targetInput = fileInputs[fileInputs.length - 1];
                }
                targetInput.click();
              }
              return;
          }

          photo.setCoords();
          canvas.renderAll();
        });
      });
    }

    /** Listen for radio/select/color changes and update CSS + canvas */
    _bindOptionChanges() {
      var self = this;
      var relocated = document.querySelector('.ls-customizer-relocated');
      var inputs = qsa('input[type="radio"], select', this.root);
      if (relocated) {
        inputs = inputs.concat(qsa('input[type="radio"], select', relocated));
      }
      inputs.forEach(function (input) {
        input.addEventListener('change', function () {
          self._handleOptionChange(input);
        });
      });
    }

    _handleOptionChange(input) {
      var propName = (input.name || '').replace('properties[', '').replace(']', '');
      var value = input.value;

      var mapping = PROPERTY_TO_CSS[propName];
      if (!mapping) return;

      var cssValue;
      if (mapping.map && OPTION_MAPS[mapping.map]) {
        cssValue = OPTION_MAPS[mapping.map][value];
      } else {
        cssValue = value;
      }

      if (cssValue) {
        this.previewEl.style.setProperty(mapping.prop, cssValue);
      }

      // Update canvas border color if applicable
      if (this.canvas && this.canvas._lsBorderRect && this.config.border) {
        var newColor = this.config.border.colorFixed
          || getComputedStyle(this.previewEl).getPropertyValue(this.config.border.colorVar).trim();
        if (newColor) {
          this.canvas._lsBorderRect.set('stroke', newColor);
          this.canvas.renderAll();
        }
      }

      // Update coin rim gradient
      if (this.canvas && this.canvas._lsCoinRim && propName === 'Finish') {
        var colors = value === 'Silver'
          ? [{ offset: 0, color: '#C0C0C0' }, { offset: 0.5, color: '#A8A8A8' }, { offset: 1, color: '#D3D3D3' }]
          : [{ offset: 0, color: '#D4AF37' }, { offset: 0.5, color: '#B8860B' }, { offset: 1, color: '#DAA520' }];
        var grad = new fabric.Gradient({
          type: 'radial',
          coords: { x1: this.canvas.width / 2, y1: this.canvas.height / 2, r1: 0, x2: this.canvas.width / 2, y2: this.canvas.height / 2, r2: this.canvas.width / 2 },
          colorStops: colors
        });
        this.canvas._lsCoinRim.set('fill', grad);
        this.canvas.renderAll();
      }

      // Update clip path when shape changes
      if (mapping.prop === '--ls-shape' && this.canvas) {
        var photo = this.photoImage;
        if (photo) {
          // Delay slightly so CSS var is updated
          var self = this;
          setTimeout(function () {
            var clip = self._createClipPath(self.canvas);
            if (clip) {
              photo.clipPath = clip;
              self.canvas.renderAll();
            }
          }, 50);
        }
      }

      // Special: hide base for "No Base" on desktop plaque
      if (this.baseEl && propName === 'Wood Base & Lighting') {
        this.baseEl.style.display = value === 'No Base' ? 'none' : '';
      }
    }

    /** Coin front/back toggle */
    _bindCoinToggle() {
      if (this.type !== 'coin') return;
      var self = this;
      var toggleBtns = qsa('.ls-preview__coin-btn', this.previewEl);

      toggleBtns.forEach(function (btn) {
        btn.addEventListener('click', function () {
          toggleBtns.forEach(function (b) { b.classList.remove('is-active'); });
          btn.classList.add('is-active');
          var face = btn.dataset.face;
          self._activeFace = face;
          self.previewEl.setAttribute('data-preview-face', face);
        });
      });
    }
  }

  /* ------------------------------------------------------------------
     Initialization
  ------------------------------------------------------------------ */

  function init() {
    qsa('.ls-customizer').forEach(function (el) {
      if (!el._lsCustomizer) {
        el._lsCustomizer = new LsProductCustomizer(el);
        el._lsPreview = new LsPreview(el);
      }
    });
  }

  // Init on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Re-init on Shopify section events (Theme Editor)
  document.addEventListener('shopify:section:load', init);
})();

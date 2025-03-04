import { createPopper, Placement } from '@popperjs/core';
import isFunction from 'lodash/isFunction';
import isObject from 'lodash/isObject';
import debounce from 'lodash/debounce';
import isString from 'lodash/isString';
import {
  computed,
  defineComponent,
  inject,
  InjectionKey,
  nextTick,
  onUnmounted,
  provide,
  ref,
  Ref,
  toRefs,
  Transition,
  watch,
} from 'vue';
import { useContent, useTNodeJSX } from '../hooks';
import { useCommonClassName, usePrefixClass } from '../hooks/useConfig';
import useVModel from '../hooks/useVModel';
import { off, on, once } from '../utils/dom';
import setStyle from '../_common/js/utils/set-style';
import Container from './container';
import props from './props';
import { TdPopupProps } from './type';

const POPUP_ATTR_NAME = 'data-td-popup';
const POPUP_PARENT_ATTR_NAME = 'data-td-popup-parent';

/**
 * @param id
 * @param upwards query upwards poppers
 */
function getPopperTree(id: number | string, upwards?: boolean): Element[] {
  const list = [] as any;
  const selectors = [POPUP_PARENT_ATTR_NAME, POPUP_ATTR_NAME];

  if (!id) return list;
  if (upwards) {
    selectors.unshift(selectors.pop());
  }

  recurse(id);

  return list;

  function recurse(id: number | string) {
    const children = document.querySelectorAll(`[${selectors[0]}="${id}"]`);
    children.forEach((el) => {
      list.push(el);
      const childId = el.getAttribute(selectors[1]);
      if (childId && childId !== id) {
        recurse(childId);
      }
    });
  }
}

const parentKey = Symbol() as InjectionKey<{
  id: string;
  assertMouseLeave: (ev: MouseEvent) => void;
}>;

function getPopperPlacement(placement: TdPopupProps['placement']): Placement {
  return placement.replace(/-(left|top)$/, '-start').replace(/-(right|bottom)$/, '-end') as Placement;
}

function attachListeners(elm: Ref<Element>) {
  const offs: Array<() => void> = [];
  return {
    add<K extends keyof HTMLElementEventMap>(type: K, listener: (ev: HTMLElementEventMap[K]) => void) {
      if (!type) return;
      on(elm.value, type, listener);
      offs.push(() => {
        off(elm.value, type, listener);
      });
    },
    clean() {
      offs.forEach((handler) => handler?.());
      offs.length = 0;
    },
  };
}

export default defineComponent({
  name: 'TPopup',

  props: {
    ...props,
    expandAnimation: {
      type: Boolean,
    },
  },
  setup(props, { expose }) {
    const { visible: propVisible, modelValue } = toRefs(props);
    const [visible, setVisible] = useVModel(
      propVisible,
      modelValue,
      props.defaultVisible,
      props.onVisibleChange,
      'visible',
    );
    const renderTNodeJSX = useTNodeJSX();
    const renderContent = useContent();

    /** popperjs instance */
    let popper: ReturnType<typeof createPopper>;
    /** timeout id */
    let showTimeout: any;
    let hideTimeout: any;

    const triggerEl = ref<HTMLElement>(null);
    const overlayEl = ref<HTMLElement>(null);
    const popperEl = ref<HTMLElement>(null);
    const containerRef = ref<typeof Container>(null);

    const id = typeof process !== 'undefined' && process.env?.TEST ? '' : Date.now().toString(36);
    const parent = inject(parentKey, undefined);

    provide(parentKey, {
      id,
      assertMouseLeave: onMouseLeave,
    });

    const prefixCls = usePrefixClass('popup');
    const { STATUS: commonCls } = useCommonClassName();
    const delay = computed(() => {
      const delay = props.trigger !== 'hover' ? [0, 0] : [].concat(props.delay ?? [250, 150]);
      return {
        show: delay[0],
        hide: delay[1] ?? delay[0],
      };
    });

    const trigger = attachListeners(triggerEl);

    watch(
      () => [props.trigger, triggerEl.value],
      () => {
        if (!triggerEl.value) return;
        trigger.clean();

        trigger.add(
          (
            {
              hover: 'mouseenter',
              focus: 'focusin',
              'context-menu': 'contextmenu',
              click: 'click',
            } as any
          )[props.trigger],
          (ev: MouseEvent) => {
            if (props.disabled) return;

            if (ev.type === 'contextmenu') {
              ev.preventDefault();
            }

            if ((ev.type === 'click' || ev.type === 'contextmenu') && visible.value) {
              hide(ev);
              return;
            }

            show(ev);
          },
        );

        trigger.add(
          (
            {
              hover: 'mouseleave',
              focus: 'focusout',
            } as any
          )[props.trigger],
          hide,
        );
      },
    );

    watch(
      () => [props.overlayStyle, props.overlayInnerStyle, overlayEl.value],
      () => {
        updateOverlayInnerStyle();
        updatePopper();
      },
    );

    watch(
      () => props.placement,
      () => {
        destroyPopper();
        updatePopper();
      },
    );

    watch(
      () => visible.value,
      (visible) => {
        if (visible) {
          on(document, 'mousedown', onDocumentMouseDown, true);
          if (props.trigger === 'focus') {
            once(triggerEl.value, 'keydown', (ev: KeyboardEvent) => {
              const code = typeof process !== 'undefined' && process.env?.TEST ? '27' : 'Escape';
              if (ev.code === code) {
                hide(ev);
              }
            });
          }
          return;
        }
        off(document, 'mousedown', onDocumentMouseDown, true);
      },
    );

    onUnmounted(() => {
      destroyPopper();
      clearAllTimeout();
      off(document, 'mousedown', onDocumentMouseDown, true);
    });

    expose({
      update: updatePopper,
      close: () => hide(),
      getOverlay() {
        return overlayEl.value;
      },
    });

    function getOverlayStyle() {
      const { overlayStyle } = props;

      if (!triggerEl.value || !overlayEl.value) return;
      if (isFunction(overlayStyle)) {
        return overlayStyle(triggerEl.value, overlayEl.value);
      }
      if (isObject(overlayStyle)) {
        return overlayStyle;
      }
    }

    function updateOverlayInnerStyle() {
      const { overlayInnerStyle } = props;

      if (!triggerEl.value || !overlayEl.value) return;
      if (isFunction(overlayInnerStyle)) {
        setStyle(overlayEl.value, overlayInnerStyle(triggerEl.value, overlayEl.value));
      } else if (isObject(overlayInnerStyle)) {
        setStyle(overlayEl.value, overlayInnerStyle);
      }
    }

    function updatePopper() {
      if (!popperEl.value || !visible.value) return;
      if (popper) {
        const rect = triggerEl.value.getBoundingClientRect();
        let parent = triggerEl.value;
        while (parent && parent !== document.body) {
          parent = parent.parentElement;
        }
        const isHidden = parent !== document.body || (rect.width === 0 && rect.height === 0);
        if (!isHidden) {
          popper.state.elements.reference = triggerEl.value;
          popper.update();
        } else {
          setVisible(false, { trigger: getTriggerType({ type: 'mouseenter' } as Event) });
        }
        return;
      }

      popper = createPopper(triggerEl.value, popperEl.value, {
        placement: getPopperPlacement(props.placement),
        onFirstUpdate: () => {
          nextTick(updatePopper);
        },
        ...props.popperOptions,
      });
    }

    function destroyPopper() {
      if (popper) {
        popper?.destroy();
        popper = null;
      }
      if (props.destroyOnClose) {
        containerRef.value?.unmountContent();
      }
    }

    function show(ev: Event) {
      clearAllTimeout();
      showTimeout = setTimeout(() => {
        setVisible(true, { trigger: getTriggerType(ev) });
      }, delay.value.show);
    }

    function hide(ev?: Event) {
      clearAllTimeout();
      hideTimeout = setTimeout(() => {
        setVisible(false, { trigger: getTriggerType(ev) });
      }, delay.value.hide);
    }

    function clearAllTimeout() {
      clearTimeout(showTimeout);
      clearTimeout(hideTimeout);
    }

    function getTriggerType(ev?: Event) {
      switch (ev?.type) {
        case 'mouseenter':
        case 'mouseleave':
          return 'trigger-element-hover';
        case 'focusin':
          return 'trigger-element-focus';
        case 'focusout':
          return 'trigger-element-blur';
        case 'click':
          return 'trigger-element-click';
        case 'context-menu':
        case 'keydown':
          return 'keydown-esc';
        case 'mousedown':
          return 'document';
        default:
          return 'trigger-element-close';
      }
    }

    function onDocumentMouseDown(ev: MouseEvent) {
      // click content
      if (popperEl.value.contains(ev.target as Node)) {
        return;
      }

      // click trigger element
      if (triggerEl.value.contains(ev.target as Node)) {
        return;
      }

      // ignore upwards
      const activedPopper = getPopperTree(id).find((el) => el.contains(ev.target as Node));
      if (
        activedPopper &&
        getPopperTree(activedPopper.getAttribute(POPUP_PARENT_ATTR_NAME), true).some((el) => el === popperEl.value)
      ) {
        return;
      }

      hide(ev);
    }

    function onMouseLeave(ev: MouseEvent) {
      if (props.trigger !== 'hover' || triggerEl.value.contains(ev.target as Node)) return;

      const isCursorOverlaps = getPopperTree(id).some((el) => {
        const rect = el.getBoundingClientRect();

        return ev.x > rect.x && ev.x < rect.x + rect.width && ev.y > rect.y && ev.y < rect.y + rect.height;
      });
      if (!isCursorOverlaps) {
        hide(ev);
        parent?.assertMouseLeave(ev);
      }
    }

    const updateScrollTop = inject('updateScrollTop', undefined);

    function handleOnScroll(e: WheelEvent) {
      const { scrollTop, clientHeight, scrollHeight } = e.target as HTMLDivElement;

      // 防止多次触发添加截流
      const debounceOnScrollBottom = debounce((e) => props.onScrollToBottom?.({ e }), 100);

      // windows 下 scrollTop 会出现小数，这里取整
      if (clientHeight + Math.floor(scrollTop) === scrollHeight) {
        // touch bottom
        debounceOnScrollBottom(e);
      }
      props.onScroll?.({ e });
    }
    watch(
      () => [visible.value, overlayEl.value],
      () => {
        if (visible.value && overlayEl.value && updateScrollTop) {
          updateScrollTop?.(overlayEl.value);
        }
      },
    );

    return () => {
      const content = renderTNodeJSX('content');
      const hidePopup = props.hideEmptyPopup && ['', undefined, null].includes(content);

      const overlay =
        visible.value || !props.destroyOnClose ? (
          <div
            {...{
              [POPUP_ATTR_NAME]: id,
              [POPUP_PARENT_ATTR_NAME]: parent?.id,
            }}
            class={[prefixCls.value, props.overlayClassName]}
            ref={(ref: HTMLElement) => (popperEl.value = ref)}
            style={[{ zIndex: props.zIndex }, getOverlayStyle(), hidePopup && { visibility: 'hidden' }]}
            vShow={visible.value}
            {...(props.trigger === 'hover' && {
              onMouseenter: () => {
                if (visible.value) {
                  clearAllTimeout();
                }
              },
              onMouseleave: onMouseLeave,
            })}
          >
            <div
              class={[
                `${prefixCls.value}__content`,
                {
                  [`${prefixCls.value}__content--text`]: isString(props.content),
                  [`${prefixCls.value}__content--arrow`]: props.showArrow,
                  [commonCls.value.disabled]: props.disabled,
                },
                props.overlayInnerClassName,
              ]}
              ref={(ref: HTMLElement) => (overlayEl.value = ref)}
              onScroll={handleOnScroll}
            >
              {content}
              {props.showArrow && <div class={`${prefixCls.value}__arrow`} />}
            </div>
          </div>
        ) : null;

      return (
        <Container
          ref={(ref: any) => (containerRef.value = ref)}
          forwardRef={(ref) => (triggerEl.value = ref)}
          onContentMounted={() => {
            if (visible.value) {
              updatePopper();
              updateOverlayInnerStyle();
            }
          }}
          onResize={() => {
            if (visible.value) {
              updatePopper();
            }
          }}
          visible={visible.value}
          attach={props.attach}
        >
          {{
            content: () => (
              <Transition
                name={`${prefixCls.value}--animation${props.expandAnimation ? '-expand' : ''}`}
                appear
                onEnter={updatePopper}
                onAfterLeave={destroyPopper}
              >
                {overlay}
              </Transition>
            ),
            default: () => renderContent('default', 'triggerElement'),
          }}
        </Container>
      );
    };
  },
});

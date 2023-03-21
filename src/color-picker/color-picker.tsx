import { defineComponent, ref, toRefs } from 'vue';
import useVModel from '../hooks/useVModel';
import { renderTNodeJSXDefault } from '../utils/render-tnode';
import props from './props';
import Popup from '../popup';
import ColorPanel from './panel';
import DefaultTrigger from './trigger';
import { useBaseClassName } from './hooks';

import type { TdColorContext } from './interfaces';

export default defineComponent({
  name: 'TColorPicker',
  props: {
    ...props,
  },
  setup(props) {
    const baseClassName = useBaseClassName();
    const visible = ref(false);
    const setVisible = (value: boolean) => (visible.value = value);

    const { value: inputValue, modelValue } = toRefs(props);
    const [innerValue, setInnerValue] = useVModel(inputValue, modelValue, props.defaultValue, props.onChange);

    const refTrigger = ref<HTMLElement>();

    const renderPopupContent = () => {
      if (props.disabled) {
        return null;
      }
      const newProps = { ...props };
      delete newProps.onChange;
      return (
        <ColorPanel
          {...newProps}
          disabled={props.disabled}
          value={innerValue.value}
          togglePopup={setVisible}
          onChange={(value: string, context: TdColorContext) => setInnerValue(value, context)}
        />
      );
    };

    return {
      baseClassName,
      innerValue,
      visible,
      refTrigger,
      renderPopupContent,
      setVisible,
      setInnerValue,
    };
  },
  render() {
    const { popupProps, baseClassName } = this;
    const popProps = {
      placement: 'bottom-left',
      ...((popupProps as any) || {}),
      trigger: 'click',
      attach: 'body',
      overlayClassName: [baseClassName],
      visible: this.visible,
      overlayInnerStyle: {
        padding: 0,
      },
      onVisibleChange: (
        visible: boolean,
        context: {
          trigger: string;
        },
      ) => {
        if (context.trigger === 'document') {
          this.setVisible(false);
        }
      },
    };
    return (
      <Popup {...popProps} content={this.renderPopupContent}>
        <div class={`${baseClassName}__trigger`} onClick={() => this.setVisible(!this.visible)} ref="refTrigger">
          {renderTNodeJSXDefault(
            this,
            'default',
            <DefaultTrigger
              color={this.innerValue}
              disabled={this.disabled}
              clearable={this.clearable}
              input-props={this.inputProps}
              onTriggerChange={this.setInnerValue}
            />,
          )}
        </div>
      </Popup>
    );
  },
});

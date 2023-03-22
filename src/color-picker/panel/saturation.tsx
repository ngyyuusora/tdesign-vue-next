import { computed, defineComponent, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { SATURATION_PANEL_DEFAULT_HEIGHT, SATURATION_PANEL_DEFAULT_WIDTH } from '../const';
import { Draggable, Coordinate } from '../utils';
import { useBaseClassName } from '../hooks';
import baseProps from './base-props';

export default defineComponent({
  name: 'SaturationPanel',

  props: {
    ...baseProps,
    removeGradientPoint: Function,
  },
  setup(props) {
    const baseClassName = useBaseClassName();
    const refPanel = ref<HTMLElement>(null);
    const refThumb = ref<HTMLElement>(null);
    const dragInstance = ref<Draggable>(null);
    const panelRect = reactive({
      width: SATURATION_PANEL_DEFAULT_WIDTH,
      height: SATURATION_PANEL_DEFAULT_HEIGHT,
    });

    const styles = computed(() => {
      const { saturation, value } = props.color;
      const { width, height } = panelRect;
      const top = Math.round((1 - value) * height);
      const left = Math.round(saturation * width);
      return {
        color: props.color.rgb,
        left: `${left}px`,
        top: `${top}px`,
      };
    });

    const getSaturationAndValueByCoordinate = (coordinate: Coordinate) => {
      const { width, height } = panelRect;
      const { x, y } = coordinate;
      const saturation = Math.round((x / width) * 100);
      const value = Math.round((1 - y / height) * 100);
      return {
        saturation,
        value,
      };
    };

    const handleDrag = (coordinate: Coordinate, isEnded?: boolean) => {
      if (props.disabled) {
        return;
      }
      const { saturation, value } = getSaturationAndValueByCoordinate(coordinate);
      props.onChange({
        saturation: saturation / 100,
        value: value / 100,
        addUsedColor: isEnded,
      });
    };

    const handleDragEnd = (coordinate: Coordinate) => {
      if (props.disabled) {
        return;
      }
      nextTick(() => {
        handleDrag(coordinate, true);
      });
    };

    const panelBackground = computed(() => {
      return `hsl(${props.color.hue}, 100%, 50%)`;
    });

    const handleDropRemove = (event: DragEvent) => {
      const selectedId = event.dataTransfer.getData('selectedId');
      const points = props.color.gradientColors;
      let pos = points.findIndex((c) => c.id === selectedId);
      const { length } = points;
      // 必须保证有两个点
      if (length > 2 && pos >= 0 && pos <= length - 1) {
        points.splice(pos, 1);
        if (!points[pos]) {
          // eslint-disable-next-line no-nested-ternary
          pos = points[pos + 1] ? pos + 1 : points[pos - 1] ? pos - 1 : 0;
        }
        handleColorsChange(points, true);
      }
    };

    onMounted(() => {
      panelRect.width = refPanel.value.offsetWidth || SATURATION_PANEL_DEFAULT_WIDTH;
      panelRect.height = refPanel.value.offsetHeight || SATURATION_PANEL_DEFAULT_HEIGHT;
      dragInstance.value = new Draggable(refPanel.value, {
        start() {
          panelRect.width = refPanel.value.offsetWidth;
          panelRect.height = refPanel.value.offsetHeight;
        },
        drag: (coordinate: Coordinate) => {
          handleDrag(coordinate);
        },
        end: handleDragEnd,
      });
    });

    onBeforeUnmount(() => {
      dragInstance.value.destroy();
    });

    return {
      baseClassName,
      refThumb,
      refPanel,
      styles,
      panelBackground,
      handleDropRemove,
    };
  },
  render() {
    const { baseClassName, styles, panelBackground, handleDropRemove } = this;
    return (
      <div
        class={[`${baseClassName}__saturation`]}
        ref="refPanel"
        style={{
          background: panelBackground,
        }}
        onDrop={handleDropRemove}
      >
        <span class={[`${baseClassName}__thumb`]} role="slider" tabindex={0} ref="refThumb" style={styles}></span>
      </div>
    );
  },
});

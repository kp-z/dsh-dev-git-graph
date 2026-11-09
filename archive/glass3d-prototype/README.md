# 已搁置：three.js 玻璃实体原型

这条线已停用，只作为记录保留，不参与构建、不进产物、不被测试收集。

当时的结论：圆形（球体）与方形（圆角板）的刚体物理与几何是可用的，14 条断言全过；
但渲染出来的观感**不够像真玻璃**（平面只有柔渐变、方板只剩倒角描边），
而根因是底图缺少高对比硬边结构，玻璃没有可折射的东西。要复活这条线，先解决这个。

重物已删除，恢复方式：

    mkdir -p scripts/glass3d/vendor
    curl -sL -o scripts/glass3d/vendor/three.module.js \
      https://unpkg.com/three@0.169.0/build/three.module.js
    mv archive/glass3d-prototype/{specs,geometry,physics}.mjs scripts/glass3d/
    mv archive/glass3d-prototype/scene.js scripts/glass3d/
    mv archive/glass3d-prototype/*.test.js scripts/glass3d/
    mv archive/glass3d-prototype/build-glass-3d-demo.mjs scripts/
    node scripts/build-glass-3d-demo.mjs

（生成脚本里的路径假设它位于 scripts/ 下，因此恢复时需先移回原位。）

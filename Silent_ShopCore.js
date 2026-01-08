/*:
 * @target MZ
 * @plugindesc v1.0.1 商店核心，可以设置限购次数及显示条件。
 * @author Silent
 *
 * @help
 * 使用说明：
 * 1. 事件中使用插件指令进行设置即可（可以同时设置多个插件指令，能同时生效）。
 *
 * @command setLimit
 * @text 设置限购与显示条件
 * @desc 批量为物品设置限购及开启条件（独立计数）。
 *
 * @arg idPrefix
 * @text 唯一ID前缀
 * @desc 用于区分不同批次的限购。
 * @type string
 * @default shop1
 *
 * @arg itemType
 * @text 物品类型
 * @type select
 * @option 物品 @value item
 * @option 武器 @value weapon
 * @option 防具 @value armor
 * @default item
 *
 * @arg itemIds
 * @text 物品ID列表(数组)
 * @type number[]
 * @default ["1"]
 *
 * @arg maxCount
 * @text 最大购买次数
 * @type number
 * @min 1
 * @default 10
 *
 * @arg isGlobal
 * @text 是否为全局限购
 * @desc 全局限购在所有地图生效；非全局则仅限当前地图当前事件。
 * @type boolean
 * @default false
 *
 * @arg --- 显示条件 ---
 * @arg condActorId
 * @text 必须在队的成员
 * @type actor
 * @default 0
 * @arg condClassId
 * @text 必须存在的职业
 * @type class
 * @default 0
 * @arg condSwitchId
 * @text 必须开启的开关
 * @type switch
 * @default 0
 * @arg condVarId
 * @text 变量检查
 * @type variable
 * @default 0
 * @arg condVarValue
 * @text 变量目标值
 * @type number
 * @default 1
 *
 * @command resetLimit
 * @text 恢复购买次数
 * @arg idPrefix
 * @text 唯一ID前缀
 * @type string
 */

(() => {
    const pluginName = "Silent_ShopCore";

    // --- 数据持久化层 ---
    const _Game_System_initialize = Game_System.prototype.initialize;
    Game_System.prototype.initialize = function() {
        _Game_System_initialize.call(this);
        // 全局限购数据
        this._globalShopLimits = {}; 
        // 非全局（事件）限购数据：{ "mapId_eventId": { key: data } }
        this._persistentEventLimits = {}; 
    };

    // 生成物品唯一识别键
    const makeItemKey = (type, id) => `${type}_${id}`;

    // 生成事件唯一识别键（用于跨地图持久化）
    const makeEventKey = () => {
        const mapId = $gameMap.mapId();
        const eventId = $gameMap._interpreter.eventId();
        return `${mapId}_${eventId}`;
    };

    // --- 核心：获取限购数据 ---
    const getLimitDataForItem = (item) => {
        if (!item) return null;
        const type = DataManager.isItem(item) ? "item" : (DataManager.isWeapon(item) ? "weapon" : "armor");
        const itemKey = makeItemKey(type, item.id);
        const eventKey = makeEventKey();

        // 1. 优先检查当前事件的持久化数据
        if ($gameSystem._persistentEventLimits[eventKey] && $gameSystem._persistentEventLimits[eventKey][itemKey]) {
            return $gameSystem._persistentEventLimits[eventKey][itemKey];
        }
        // 2. 检查全局数据
        if ($gameSystem._globalShopLimits[itemKey]) {
            return $gameSystem._globalShopLimits[itemKey];
        }
        return null;
    };

    const checkVisibleCondition = (data) => {
        if (!data) return true;
        if (data.actorId > 0 && !$gameParty.members().some(a => a.actorId() === data.actorId)) return false;
        if (data.classId > 0 && !$gameParty.members().some(a => a.currentClass().id === data.classId)) return false;
        if (data.switchId > 0 && !$gameSwitches.value(data.switchId)) return false;
        if (data.varId > 0 && $gameVariables.value(data.varId) < data.varValue) return false;
        return true;
    };

    // --- 插件指令 ---
    PluginManager.registerCommand(pluginName, "setLimit", args => {
        const isGlobal = args.isGlobal === "true";
        const type = args.itemType;
        const ids = JSON.parse(args.itemIds).map(Number);
        const eventKey = makeEventKey();
        
        ids.forEach(itemId => {
            const itemKey = makeItemKey(type, itemId);
            const data = {
                max: parseInt(args.maxCount),
                current: parseInt(args.maxCount),
                actorId: parseInt(args.condActorId),
                classId: parseInt(args.condClassId),
                switchId: parseInt(args.condSwitchId),
                varId: parseInt(args.condVarId),
                varValue: parseInt(args.condVarValue),
                batchId: args.idPrefix 
            };

            if (isGlobal) {
                // 如果已存在全局数据，不覆盖当前购买次数，仅更新配置
                if (!$gameSystem._globalShopLimits[itemKey]) {
                    $gameSystem._globalShopLimits[itemKey] = data;
                }
            } else {
                // 初始化事件持久化容器
                if (!$gameSystem._persistentEventLimits[eventKey]) {
                    $gameSystem._persistentEventLimits[eventKey] = {};
                }
                // 如果该事件该物品未记录过，则初始化
                if (!$gameSystem._persistentEventLimits[eventKey][itemKey]) {
                    $gameSystem._persistentEventLimits[eventKey][itemKey] = data;
                }
            }
        });
    });

    PluginManager.registerCommand(pluginName, "resetLimit", args => {
        const prefix = args.idPrefix;
        const resetInPool = (pool) => {
            for (let k in pool) {
                if (pool[k].batchId === prefix) pool[k].current = pool[k].max;
            }
        };
        // 重置全局
        resetInPool($gameSystem._globalShopLimits);
        // 重置所有持久化事件中的匹配项
        for (let eKey in $gameSystem._persistentEventLimits) {
            resetInPool($gameSystem._persistentEventLimits[eKey]);
        }
    });

    // --- 商店界面与逻辑扩展 ---
    const _Window_ShopBuy_makeItemList = Window_ShopBuy.prototype.makeItemList;
    Window_ShopBuy.prototype.makeItemList = function() {
        _Window_ShopBuy_makeItemList.call(this);
        const newData = [];
        const newPrice = [];
        for (let i = 0; i < this._data.length; i++) {
            const item = this._data[i];
            const limitData = getLimitDataForItem(item);
            if (checkVisibleCondition(limitData)) {
                newData.push(item);
                newPrice.push(this._price[i]);
            }
        }
        this._data = newData;
        this._price = newPrice;
    };

    const _Window_ShopNumber_setup = Window_ShopNumber.prototype.setup;
    Window_ShopNumber.prototype.setup = function(item, max, price) {
        const limitData = getLimitDataForItem(item);
        const finalMax = limitData ? Math.min(max, limitData.current) : max;
        _Window_ShopNumber_setup.call(this, item, finalMax, price);
    };

    const _Scene_Shop_doBuy = Scene_Shop.prototype.doBuy;
    Scene_Shop.prototype.doBuy = function(number) {
        _Scene_Shop_doBuy.call(this, number);
        const limitData = getLimitDataForItem(this._item);
        if (limitData) {
            limitData.current = Math.max(0, limitData.current - number);
        }
    };

    const _Window_ShopBuy_isEnabled = Window_ShopBuy.prototype.isEnabled;
    Window_ShopBuy.prototype.isEnabled = function(item) {
        const original = _Window_ShopBuy_isEnabled.call(this, item);
        const limitData = getLimitDataForItem(item);
        if (limitData && limitData.current <= 0) return false;
        return original;
    };

    const _Window_ShopStatus_refresh = Window_ShopStatus.prototype.refresh;
    Window_ShopStatus.prototype.refresh = function() {
        _Window_ShopStatus_refresh.call(this);
        if (this._item) {
            const limitData = getLimitDataForItem(this._item);
            if (limitData) {
                const y = this.innerHeight - this.lineHeight() - 10;
                this.contents.fontSize = 18;
                this.changeTextColor("#ff4d4d"); 
                this.drawText(`可购买次数 ${limitData.current}/${limitData.max}`, 4, y, this.innerWidth - 8, "center");
                this.resetFontSettings();
            }
        }
    };
})();
/*:
 * @target MZ
 * @plugindesc v1.2 商店核心：支持限购、多货币系统、特殊货币售出价选择。
 * @author Silent
 *
 * @help
 * ============================================================================
 * 功能 1: 限购与显示条件
 * ============================================================================
 * 使用插件指令进行设置。
 * 
 * ============================================================================
 * 功能 2: 多货币系统
 * ============================================================================
 * 在数据库的 物品/武器/防具 备注栏中添加以下标签：
 *
 * <货币:v,ID,数量>  -> 使用变量作为货币
 * <货币:i,ID,数量>  -> 使用物品作为货币
 * <货币:w,ID,数量>  -> 使用武器作为货币
 * <货币:a,ID,数量>  -> 使用防具作为货币
 *
 * 示例：
 * <货币:v,10,500>   -> 价格为 500 点 10号变量
 * <货币:i,1,5>      -> 价格为 5 个 1号物品
 * 
 * ============================================================================
 * 备注：
 * ============================================================================
 * 出售倍率仅针对多货币，不涉及原本金币的交易（还是默认的50%回收价格）。
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
 *
 *
 * ============================================================================
 * 设置
 * ============================================================================
 * @param goldIconId
 * @text 金币图标ID
 * @desc 也就是右上角显示金币时，左侧显示的图标索引。
 * @type number
 * @default 313
 * 
 * @param sellRatio
 * @text 多货币出售倍率
 * @desc 玩家向商店出售多货币物品时的回收价格倍率。
 * @type select
 * @option 原价出售 (100%)
 * @value 1.0
 * @option 半价出售 (50%)
 * @value 0.5
 * @default 1.0
 * 
 * @param variableIcons
 * @text 变量货币图标配置
 * @desc 为特定的变量货币设置其在界面显示的图标。
 * @type struct<VarIcon>[]
 * @default []
 *
 */

/*~struct~VarIcon:
 * @param varId
 * @text 变量ID
 * @type variable
 *
 * @param iconId
 * @text 图标ID
 * @type number
 * @default 0
 */

(() => {
    const pluginName = "Silent_ShopCore";
    const parameters = PluginManager.parameters(pluginName);
    const pGoldIconId = parseInt(parameters['goldIconId'] || 0);
    // 新增：读取出售倍率，默认为 1.0 (原价)
    const pSellRatio = parseFloat(parameters['sellRatio'] || 1.0);

    // 解析变量图标映射表
    const vIconMap = {};
    const rawVIconData = JSON.parse(parameters['variableIcons'] || "[]");
    rawVIconData.forEach(str => {
        const obj = JSON.parse(str);
        if (obj.varId) vIconMap[Number(obj.varId)] = Number(obj.iconId || 0);
    });

    // ========================================================================
    //  Part 0: 基础数据结构与工具函数
    // ========================================================================

    const _Game_System_initialize = Game_System.prototype.initialize;
    Game_System.prototype.initialize = function() {
        _Game_System_initialize.call(this);
        this._globalShopLimits = {}; 
        this._persistentEventLimits = {}; 
    };

    const makeItemKey = (type, id) => `${type}_${id}`;
    const makeEventKey = () => {
        const mapId = $gameMap.mapId();
        const eventId = $gameMap._interpreter ? $gameMap._interpreter.eventId() : 0;
        return `${mapId}_${eventId}`;
    };

    const getLimitDataForItem = (item) => {
        if (!item) return null;
        const type = DataManager.isItem(item) ? "item" : (DataManager.isWeapon(item) ? "weapon" : "armor");
        const itemKey = makeItemKey(type, item.id);
        const eventKey = makeEventKey();

        if ($gameSystem._persistentEventLimits[eventKey] && $gameSystem._persistentEventLimits[eventKey][itemKey]) {
            return $gameSystem._persistentEventLimits[eventKey][itemKey];
        }
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

    // 获取货币信息
    const getCurrencyData = (item) => {
        if (!item || !item.meta) return null;
        const meta = item.meta['货币'] || item.meta['Currency']; 
        if (!meta) return null;

        const match = meta.match(/([viwa]),\s*(\d+),\s*(\d+)/i);
        if (match) {
            const type = match[1].toLowerCase();
            const id = parseInt(match[2]);
            const cost = parseInt(match[3]);
            let obj = null;
            if (type === 'i') obj = $dataItems[id];
            if (type === 'w') obj = $dataWeapons[id];
            if (type === 'a') obj = $dataArmors[id];
            
            return { type, id, cost, obj };
        }
        return null;
    };

    // 获取当前持有的货币数量
    const getPartyCurrencyValue = (cData) => {
        if (!cData) return $gameParty.gold();
        switch (cData.type) {
            case 'v': return $gameVariables.value(cData.id);
            case 'i': 
            case 'w': 
            case 'a': return $gameParty.numItems(cData.obj);
            default: return 0;
        }
    };

    const losePartyCurrency = (cData, amount) => {
        if (!cData) {
            $gameParty.loseGold(amount);
            return;
        }
        const totalCost = cData.cost * amount;
        switch (cData.type) {
            case 'v': 
                $gameVariables.setValue(cData.id, $gameVariables.value(cData.id) - totalCost);
                break;
            case 'i': 
            case 'w': 
            case 'a': 
                $gameParty.loseItem(cData.obj, totalCost);
                break;
        }
    };

    const gainPartyCurrency = (cData, amount) => {
        if (!cData) {
            $gameParty.gainGold(amount); 
            return;
        }
        switch (cData.type) {
            case 'v': 
                $gameVariables.setValue(cData.id, $gameVariables.value(cData.id) + amount);
                break;
            case 'i': 
            case 'w': 
            case 'a': 
                $gameParty.gainItem(cData.obj, amount);
                break;
        }
    };

    // ========================================================================
    //  Part 1: 插件指令
    // ========================================================================

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
                if (!$gameSystem._globalShopLimits[itemKey]) {
                    $gameSystem._globalShopLimits[itemKey] = data;
                }
            } else {
                if (!$gameSystem._persistentEventLimits[eventKey]) {
                    $gameSystem._persistentEventLimits[eventKey] = {};
                }
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
        resetInPool($gameSystem._globalShopLimits);
        for (let eKey in $gameSystem._persistentEventLimits) {
            resetInPool($gameSystem._persistentEventLimits[eKey]);
        }
    });

    // ========================================================================
    //  Part 2: UI 核心改造 (Window_Gold 重写)
    // ========================================================================

    const _Window_Gold_initialize = Window_Gold.prototype.initialize;
    Window_Gold.prototype.initialize = function(rect) {
        _Window_Gold_initialize.call(this, rect);
        this._customCurrencyData = null; 
    };

    Window_Gold.prototype.setCustomCurrency = function(cData) {
        this._customCurrencyData = cData;
        this.refresh();
    };

    const _Window_Gold_refresh = Window_Gold.prototype.refresh;
    Window_Gold.prototype.refresh = function() {
        if (this._customCurrencyData === undefined) {
            _Window_Gold_refresh.call(this);
            return;
        }

        const rect = this.itemLineRect(0);
        this.contents.clear();

        let value = 0;
        let iconIndex = 0;
        let nameText = "";
        
        const cData = this._customCurrencyData;

        if (cData) {
            value = getPartyCurrencyValue(cData);
            if (cData.obj) {
                iconIndex = cData.obj.iconIndex;
                nameText = cData.obj.name;
            } else if (cData.type === 'v') {
                iconIndex = vIconMap[cData.id] || 0; 
                nameText = $dataSystem.variables[cData.id] || "变量 " + cData.id;
            }
        } else {
            value = $gameParty.gold();
            iconIndex = pGoldIconId; 
            nameText = TextManager.currencyUnit;
        }

        let x = rect.x;
        const iconWidth = ImageManager.iconWidth;
        
        if (iconIndex > 0) {
            this.drawIcon(iconIndex, x, rect.y + 2);
            x += iconWidth + 4;
        }

        const nameMaxWidth = rect.width - x - 100; 
        this.changeTextColor(ColorManager.systemColor());
        this.drawText(nameText, x, rect.y, nameMaxWidth, "left");

        this.resetTextColor();
        this.drawText(value, rect.x, rect.y, rect.width, "right");
    };

    // ========================================================================
    //  Part 2.2: Scene_Shop 建立窗口联动
    // ========================================================================

    const _Scene_Shop_createBuyWindow = Scene_Shop.prototype.createBuyWindow;
    Scene_Shop.prototype.createBuyWindow = function() {
        _Scene_Shop_createBuyWindow.call(this);
        this._goldWindow._customCurrencyData = null; 
        this._buyWindow.setGoldWindow(this._goldWindow);
    };

    const _Scene_Shop_createSellWindow = Scene_Shop.prototype.createSellWindow;
    Scene_Shop.prototype.createSellWindow = function() {
        _Scene_Shop_createSellWindow.call(this);
        this._sellWindow.setGoldWindow(this._goldWindow);
    };

    Window_ShopBuy.prototype.setGoldWindow = function(goldWindow) {
        this._linkedGoldWindow = goldWindow;
    };

    const _Window_ShopBuy_updateHelp = Window_ShopBuy.prototype.updateHelp;
    Window_ShopBuy.prototype.updateHelp = function() {
        _Window_ShopBuy_updateHelp.call(this);
        if (this._linkedGoldWindow && this.item()) {
            const cData = getCurrencyData(this.item());
            this._linkedGoldWindow.setCustomCurrency(cData);
        }
    };

    Window_ShopSell.prototype.setGoldWindow = function(goldWindow) {
        this._linkedGoldWindow = goldWindow;
    };

    const _Window_ShopSell_updateHelp = Window_ShopSell.prototype.updateHelp;
    Window_ShopSell.prototype.updateHelp = function() {
        _Window_ShopSell_updateHelp.call(this);
        if (this._linkedGoldWindow) {
            const item = this.item();
            const cData = getCurrencyData(item);
            this._linkedGoldWindow.setCustomCurrency(cData);
        }
    };

    // ========================================================================
    //  Part 3: 列表显示与购买逻辑 (更新列表中的变量图标)
    // ========================================================================

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

    const _Window_ShopBuy_drawItem = Window_ShopBuy.prototype.drawItem;
    Window_ShopBuy.prototype.drawItem = function(index) {
        const item = this.itemAt(index);
        const cData = getCurrencyData(item);
        
        if (!cData) {
            _Window_ShopBuy_drawItem.call(this, index);
            return;
        }

        const rect = this.itemLineRect(index);
        this.changePaintOpacity(this.isEnabled(item));
        this.drawItemName(item, rect.x, rect.y, rect.width);
        
        const priceWidth = this.priceWidth();
        const priceX = rect.x + rect.width - priceWidth;
        const iconWidthPlus = ImageManager.iconWidth + 4;

        let drawIconIndex = 0;
        if (cData.obj) drawIconIndex = cData.obj.iconIndex;
        else if (cData.type === 'v') drawIconIndex = vIconMap[cData.id] || 0;

        if (drawIconIndex > 0) {
            this.drawIcon(drawIconIndex, priceX, rect.y + 2);
            this.drawText(cData.cost, priceX + iconWidthPlus, rect.y, priceWidth - iconWidthPlus, "right");
        } else {
            this.drawText(cData.cost, priceX, rect.y, priceWidth, "right");
        }
        this.changePaintOpacity(true);
    };

    const _Window_ShopBuy_isEnabled = Window_ShopBuy.prototype.isEnabled;
    Window_ShopBuy.prototype.isEnabled = function(item) {
        const limitData = getLimitDataForItem(item);
        if (limitData && limitData.current <= 0) return false;

        const cData = getCurrencyData(item);
        if (cData) {
            const owned = getPartyCurrencyValue(cData);
            return owned >= cData.cost;
        }
        return _Window_ShopBuy_isEnabled.call(this, item);
    };

    // 修复：Setup逻辑需要区分“买”和“卖”
    const _Window_ShopNumber_setup = Window_ShopNumber.prototype.setup;
    Window_ShopNumber.prototype.setup = function(item, max, price) {
        const cData = getCurrencyData(item);
        
        // 判断当前是否处于商店的“出售”模式
        const scene = SceneManager._scene;
        const isShopSell = scene instanceof Scene_Shop && 
                           scene._commandWindow && 
                           scene._commandWindow.currentSymbol() === 'sell';

        let realMax = max;
        let finalPrice = price;

        if (cData) {
            // 如果是多货币物品
            
            if (isShopSell) {
                // 出售模式：
                // 修正：应用出售倍率 (例如：0.5 半价)
                finalPrice = Math.floor(cData.cost * pSellRatio);

                // max 已经是当前拥有的物品数量（由Scene_Shop传入），不需要重新计算买得起多少个
                // 也不受商店库存(limitData)的限制
                realMax = max;
            } else {
                // 购买模式：价格永远是原价
                finalPrice = cData.cost;

                // 计算买得起多少个
                const owned = getPartyCurrencyValue(cData);
                const canAfford = Math.floor(owned / cData.cost);
                // 计算还能拿多少个
                const maxItems = $gameParty.maxItems(item) - $gameParty.numItems(item);
                
                realMax = Math.min(maxItems, canAfford);
                
                // 只有在购买时，才应用商店库存限制
                const limitData = getLimitDataForItem(item);
                if (limitData) {
                    realMax = Math.min(realMax, limitData.current);
                }
            }
        } else {
            // 如果是普通金币物品
            // 依然需要检查限购逻辑，但仅限购买模式
            if (!isShopSell) {
                const limitData = getLimitDataForItem(item);
                if (limitData) {
                    realMax = Math.min(realMax, limitData.current);
                }
            }
        }

        _Window_ShopNumber_setup.call(this, item, realMax, finalPrice);
        
        this._currencyData = cData;
    };

    const _Window_ShopNumber_drawTotalPrice = Window_ShopNumber.prototype.drawTotalPrice;
    Window_ShopNumber.prototype.drawTotalPrice = function() {
        if (!this._currencyData) {
            _Window_ShopNumber_drawTotalPrice.call(this);
            return;
        }
        const total = this._price * this._number;
        const width = this.innerWidth - this.itemPadding() * 2;
        const y = this.totalPriceY();
        
        this.resetTextColor();
        const cData = this._currencyData;

        let iconIdx = 0;
        if (cData.obj) iconIdx = cData.obj.iconIndex;
        else if (cData.type === 'v') iconIdx = vIconMap[cData.id] || 0;
        
        if (iconIdx > 0) {
            const iconW = ImageManager.iconWidth;
            this.drawText(total, 0, y, width, "right");
            const textWidth = this.textWidth(total);
            const iconX = width - textWidth - iconW - 4;
            this.drawIcon(iconIdx, iconX, y + 2);
        } else {
            this.drawText(total, 0, y, width, "right");
        }
    };

    // ========================================================================
    //  Part 4: 交易执行
    // ========================================================================

    const _Scene_Shop_doBuy = Scene_Shop.prototype.doBuy;
    Scene_Shop.prototype.doBuy = function(number) {
        const cData = getCurrencyData(this._item);
        if (cData) {
            losePartyCurrency(cData, number);
            $gameParty.gainItem(this._item, number);
            
            const limitData = getLimitDataForItem(this._item);
            if (limitData) {
                limitData.current = Math.max(0, limitData.current - number);
            }
            
            SoundManager.playShop();
            this._goldWindow.refresh(); 
            this._statusWindow.refresh();
            this.activateBuyWindow();
            this._buyWindow.refresh(); 
        } else {
            _Scene_Shop_doBuy.call(this, number);
        }
    };

    const _Scene_Shop_doSell = Scene_Shop.prototype.doSell;
    Scene_Shop.prototype.doSell = function(number) {
        const cData = getCurrencyData(this._item);
        if (cData) {
            // 修正：多货币物品出售时，计算倍率后的价格
            const unitPrice = Math.floor(cData.cost * pSellRatio); 
            const totalAmount = unitPrice * number;

            gainPartyCurrency(cData, totalAmount);
            $gameParty.loseItem(this._item, number);
            
            SoundManager.playShop();
            this._goldWindow.refresh();
            this._statusWindow.refresh();
            this.activateSellWindow();
            this._sellWindow.refresh();
        } else {
            _Scene_Shop_doSell.call(this, number);
        }
    };

    // ========================================================================
    //  Part 5: 状态窗口增强
    // ========================================================================
    
    const _Window_ShopStatus_refresh = Window_ShopStatus.prototype.refresh;
    Window_ShopStatus.prototype.refresh = function() {
        _Window_ShopStatus_refresh.call(this);
        if (!this._item) return;

        const limitData = getLimitDataForItem(this._item);
        if (limitData) {
            let y = this.innerHeight - this.lineHeight() - 10;
            this.contents.fontSize = 18;
            this.changeTextColor("#ff4d4d"); 
            this.drawText(`可购买次数 ${limitData.current}/${limitData.max}`, 4, y, this.innerWidth - 8, "center");
            this.resetFontSettings();
        }
    };

})();
